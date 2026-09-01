#include "apple/display/text_engine.hpp"

#include "apple/display/generated/home_run_font_select.hpp"
#include "apple/display/generated/home_run_frames.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace apple::display {

namespace gen = apple::display::generated;

const char *entrance_name(Entrance value) {
  switch (value) {
    case Entrance::Pop: return "pop";
    case Entrance::Slide: return "slide";
    case Entrance::Drop: return "drop";
    case Entrance::Spin: return "spin";
    case Entrance::Type: return "type";
  }
  return "?";
}

const char *hold_name(Hold value) {
  switch (value) {
    case Hold::Wave: return "wave";
    case Hold::Chant: return "chant";
    case Hold::Glint: return "glint";
    case Hold::Float: return "float";
    case Hold::Sparkle: return "sparkle";
    case Hold::Still: return "still";
  }
  return "?";
}

const char *exit_name(Exit value) {
  switch (value) {
    case Exit::Wipe: return "wipe";
    case Exit::Slide: return "slide";
    case Exit::Drop: return "drop";
    case Exit::Spin: return "spin";
    case Exit::Shrink: return "shrink";
    case Exit::Twirl: return "twirl";
  }
  return "?";
}

const char *font_name() { return gen::kFontName; }
const char *font_license() { return gen::kFontLicense; }
bool font_is_private() { return gen::kFontPrivate; }

namespace text {

namespace {

constexpr int kW = kLogicalWidth;
constexpr int kH = kLogicalHeight;
constexpr int kRasterRows = 120;
constexpr int kMaxScale = gen::kTextScaleFinal;
constexpr float kPi = 3.14159265f;

// Scratch for the continuous transforms (spin, twirl); rendering is single-threaded.
std::uint8_t raster[kW * kRasterRows];

float clamp01(float u) { return u < 0.f ? 0.f : (u > 1.f ? 1.f : u); }
float ease_out_cubic(float u) {
  u = clamp01(u);
  return 1.f - (1.f - u) * (1.f - u) * (1.f - u);
}
float ease_in_cubic(float u) {
  u = clamp01(u);
  return u * u * u;
}
float ease_in_quad(float u) {
  u = clamp01(u);
  return u * u;
}
int iround(float v) { return static_cast<int>(std::lround(v)); }
int half_sine(float u, float amp) {
  return (u >= 0.f && u < 1.f) ? -iround(amp * std::sin(kPi * u)) : 0;
}
float fmod_pos(float value, float period) {
  const float m = std::fmod(value, period);
  return m < 0.f ? m + period : m;
}

const gen::Glyph &glyph_for(char ch) {
  const gen::Glyph *space = &gen::kGlyphs[0];
  for (const auto &g : gen::kGlyphs) {
    if (g.ch == ch)
      return g;
    if (g.ch == ' ')
      space = &g;
  }
  return *space;
}

int shadow_offset(int scale_y) { return scale_y <= 2 ? 1 : 2; }

char normalize_char(char c) {
  if (c >= 'a' && c <= 'z')
    return static_cast<char>(c - 'a' + 'A');
  if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' ||
      c == '-' || c == '\'')
    return c;
  if (c == ' ' || c == '\t' || c == '_')
    return ' ';
  return '\0';
}

// Copy at most n characters and terminate.
void copy_line(char *dst, const char *src, std::size_t n) {
  std::size_t i = 0;
  for (; i < n && src[i] != '\0'; ++i)
    dst[i] = src[i];
  dst[i] = '\0';
}

// Drop trailing characters until the line fits the margins at scale 1.
void trim_line_to_fit(char *line, int tracking) {
  std::size_t n = std::strlen(line);
  while (n > 1 && text_width(line, tracking) > kMaxLineWidth)
    line[--n] = '\0';
}

int widest_of(const TextFit &fit) {
  int widest = 0;
  for (int i = 0; i < fit.line_count; ++i)
    widest = std::max(widest, text_width(fit.lines[i], fit.tracking));
  return widest;
}

// Scales for a set of lines: width picks the largest whole scale within the
// margins, bounded by what the height allows; when width forces 2 or less, the
// height goes one step taller if it fits (condensed, so long names fill the screen).
void fit_scales(TextFit &fit) {
  for (int i = 0; i < fit.line_count; ++i)
    trim_line_to_fit(fit.lines[i], fit.tracking);
  const int widest = widest_of(fit);
  const int block1 = fit.line_count * gen::kFontBand + (fit.line_count - 1) * gen::kLineGap;
  int by_height = 1;
  for (int s = kMaxScale; s >= 1; --s)
    if (block1 * s <= kMaxBlockHeight) { by_height = s; break; }
  int by_width = 1;
  for (int s = kMaxScale; s >= 1; --s)
    if (widest * s <= kMaxLineWidth) { by_width = s; break; }
  fit.scale_x = std::min(by_width, by_height);
  fit.scale_y = fit.scale_x >= 3 ? fit.scale_x : std::min(fit.scale_x + 1, by_height);
  fit.widest_px = widest;
}

bool better_fit(const TextFit &a, const TextFit &b) {
  if (a.scale_x != b.scale_x) return a.scale_x > b.scale_x;
  if (a.scale_y != b.scale_y) return a.scale_y > b.scale_y;
  return a.line_count < b.line_count;
}

std::uint8_t pixel_role(const Pose &p, const Layout &lay, int letter, int px, int py,
                        std::uint8_t role, Roles roles) {
  switch (p.color_mode) {
    case Pose::ColorMode::Band: {
      const float v = static_cast<float>(px + py) - p.band_c;
      return (v >= 0.f && v < static_cast<float>(p.band_w)) ? roles.glint : role;
    }
    case Pose::ColorMode::Letter: {
      if (letter != p.highlight_letter)
        return role;
      const Layout::Letter &L = lay.letters[letter];
      const bool inside = px >= L.x && px < L.x + L.w && py >= L.y &&
                          py < L.y + gen::kFontBand * lay.sy;
      return inside ? roles.glint : role;
    }
    case Pose::ColorMode::None:
      break;
  }
  return role;
}

void draw_letter(std::uint8_t *buf, const Layout &lay, int letter, int dx, int dy,
                 std::uint8_t role, const Pose *color_pose, Roles roles) {
  const Layout::Letter &L = lay.letters[letter];
  const gen::Glyph &g = glyph_for(L.ch);
  for (int j = 0; j < gen::kFontBand; ++j) {
    const int y0 = L.y + dy + j * lay.sy;
    if (y0 + lay.sy <= 0 || y0 >= kH)
      continue;
    const std::uint16_t row = g.rows[j];
    for (int i = 0; i < g.advance; ++i) {
      if ((row & (0x8000u >> i)) == 0)
        continue;
      const int x0 = L.x + dx + i * lay.sx;
      for (int py = std::max(0, y0); py < std::min(kH, y0 + lay.sy); ++py) {
        for (int px = std::max(0, x0); px < std::min(kW, x0 + lay.sx); ++px) {
          buf[py * kW + px] =
              color_pose ? pixel_role(*color_pose, lay, letter, px, py, role, roles) : role;
        }
      }
    }
  }
}

}  // namespace

int font_band() { return gen::kFontBand; }

int text_width(const char *s, int tracking) {
  int w = 0, n = 0;
  for (; *s != '\0'; ++s, ++n)
    w += glyph_for(*s).advance;
  return w + std::max(0, n - 1) * tracking;
}

int letters_in(const TextFit &fit) {
  int n = 0;
  for (int li = 0; li < fit.line_count; ++li)
    n += static_cast<int>(std::strlen(fit.lines[li]));
  return n;
}

TextFit fit_words(const char *line1, const char *line2) {
  TextFit fit;
  copy_line(fit.lines[0], line1, TextFit::kMaxLineLength);
  const bool two = line2 != nullptr && line2[0] != '\0';
  if (two)
    copy_line(fit.lines[1], line2, TextFit::kMaxLineLength);
  fit.line_count = two ? 2 : 1;
  fit_scales(fit);
  return fit;
}

TextFit fit_line(const char *line, int scale_x, int scale_y, int tracking) {
  TextFit fit;
  fit.tracking = tracking;
  copy_line(fit.lines[0], line, TextFit::kMaxLineLength);
  fit.line_count = 1;
  trim_line_to_fit(fit.lines[0], tracking);
  fit.scale_x = std::max(1, scale_x);
  fit.scale_y = std::max(1, scale_y);
  fit.widest_px = widest_of(fit);
  return fit;
}

TextFit fit_name(const char *batter_name) {
  // Normalize: uppercase, allowed characters, single spaces, capped.
  constexpr std::size_t kMax = TextFit::kMaxLineLength;
  char clean[kMax + 1] = {};
  std::size_t n = 0;
  bool pending_space = false;
  for (const char *p = batter_name; p != nullptr && *p != '\0' && n < kMax; ++p) {
    const char c = normalize_char(*p);
    if (c == '\0')
      continue;
    if (c == ' ') {
      pending_space = n > 0;
      continue;
    }
    if (pending_space && n < kMax - 1)
      clean[n++] = ' ';
    pending_space = false;
    clean[n++] = c;
  }
  clean[n] = '\0';
  if (clean[0] == '\0')
    std::strcpy(clean, " ");

  // Candidate 1: FIRST / REST (or one line when there is no space).
  TextFit best;
  const char *space = std::strchr(clean, ' ');
  if (space == nullptr) {
    copy_line(best.lines[0], clean, kMax);
    best.line_count = 1;
    fit_scales(best);
    return best;
  }
  const std::size_t first_len = static_cast<std::size_t>(space - clean);
  const char *rest = space + 1;
  copy_line(best.lines[0], clean, first_len);
  copy_line(best.lines[1], rest, kMax);
  best.line_count = 2;
  fit_scales(best);

  // Candidate 2: split REST at its last space (GUERRERO / JR.).
  const char *last_space = std::strrchr(rest, ' ');
  if (last_space != nullptr) {
    TextFit c;
    copy_line(c.lines[0], clean, first_len);
    copy_line(c.lines[1], rest, static_cast<std::size_t>(last_space - rest));
    copy_line(c.lines[2], last_space + 1, kMax);
    c.line_count = 3;
    fit_scales(c);
    if (better_fit(c, best))
      best = c;
  }
  // Candidate 3: split REST after its first hyphen (ENCARNACION- / STRAND).
  const char *hyphen = std::strchr(rest, '-');
  if (hyphen != nullptr && hyphen[1] != '\0') {
    TextFit c;
    copy_line(c.lines[0], clean, first_len);
    copy_line(c.lines[1], rest, static_cast<std::size_t>(hyphen - rest) + 1);
    copy_line(c.lines[2], hyphen + 1, kMax);
    c.line_count = 3;
    fit_scales(c);
    if (better_fit(c, best))
      best = c;
  }
  return best;
}

int pop_scale_for(int quarters, int final_scale, int widest_line_px) {
  int scale = std::max(1, iround(final_scale * quarters / 4.f));
  while (scale > final_scale && widest_line_px * scale > kMaxLineWidth)
    --scale;
  return scale;
}

Layout layout_lines(const TextFit &fit, int sx, int sy, int cx, int cy) {
  Layout lay;
  lay.sx = sx;
  lay.sy = sy;
  const int band = gen::kFontBand;
  const int block = (fit.line_count * band + (fit.line_count - 1) * gen::kLineGap) * sy;
  const int top = cy - block / 2;
  lay.left = kW;
  lay.right = 0;
  for (int li = 0; li < fit.line_count; ++li) {
    const int width = text_width(fit.lines[li], fit.tracking) * sx;
    int x = cx - width / 2;
    const int y = top + li * (band + gen::kLineGap) * sy;
    lay.left = std::min(lay.left, x);
    lay.right = std::max(lay.right, x + width);
    for (const char *p = fit.lines[li]; *p != '\0'; ++p) {
      if (lay.count >= kMaxLetters)
        break;
      const gen::Glyph &g = glyph_for(*p);
      Layout::Letter &L = lay.letters[lay.count++];
      L.ch = *p;
      L.x = x;
      L.y = y;
      L.line = li;
      L.w = g.advance * sx;
      x += (g.advance + fit.tracking) * sx;
    }
  }
  lay.top = top;
  lay.bottom = top + block;
  return lay;
}

Pose settled_pose() {
  Pose p;
  p.shadow = true;
  return p;
}

Pose hidden_pose() {
  Pose p;
  p.sx = p.sy = -1;
  return p;
}

int fall_curve(int kk) {
  if (kk < 0)
    return -200;
  if (kk <= 6)
    return -iround(120.f * (1.f - ease_in_quad(kk / 6.f)));
  if (kk == 7)
    return -5;
  if (kk == 9)
    return -2;
  return 0;
}

int slide_in(int k) {
  return k < 11 ? iround(-170.f + 173.f * ease_out_cubic(k / 10.f)) : 0;
}

Pose entrance_pose(Entrance e, int k, const TextFit &fit, int n_letters, int pop_quarters) {
  Pose p;
  switch (e) {
    case Entrance::Pop: {
      p.sx = pop_scale_for(pop_quarters, fit.scale_x, fit.widest_px);
      p.sy = std::max(1, iround(fit.scale_y * pop_quarters / 4.f));
      if (p.sx == fit.scale_x)                  // no room to overshoot in width: none in height either
        p.sy = std::min(p.sy, fit.scale_y);
      break;
    }
    case Entrance::Slide:
      p.dx = slide_in(k);
      break;
    case Entrance::Drop: {
      // Lines follow three ticks apart; two with three lines, so the last one
      // still lands before the settle step.
      const int stagger = fit.line_count >= 3 ? 2 : 3;
      for (int li = 0; li < TextFit::kMaxLines; ++li)
        p.line_dy[li] = fall_curve(k - stagger * li);
      break;
    }
    case Entrance::Spin:
      p.squash = std::min(1.f, (k + 1) / 9.f);
      break;
    case Entrance::Type: {
      // One letter per tick; more per tick when the name could not finish
      // before the settle step.
      const int per = std::max(1, (n_letters + 10) / 11);
      p.visible = std::min(n_letters, (k + 1) * per);
      break;
    }
  }
  return p;
}

void apply_hold_style(Hold h, float t, const Layout &lay, std::uint32_t seed, Pose &p) {
  switch (h) {
    case Hold::Wave: {
      if (t < 400.f)
        return;
      const float phase = fmod_pos(t - 400.f, 1500.f);
      for (int i = 0; i < lay.count; ++i)
        p.letter_dy[i] = half_sine((phase - i * 67.f) / 330.f, 3.f);
      p.has_letter_dy = true;
      return;
    }
    case Hold::Chant: {
      if (t < 400.f)
        return;
      const float phase = fmod_pos(t - 400.f, 1200.f);
      for (int li = 0; li < TextFit::kMaxLines; ++li)
        p.line_dy[li] = half_sine((phase - 330.f * li) / 220.f, 3.f);
      return;
    }
    case Hold::Glint: {
      if (t < 400.f)
        return;
      const float phase = fmod_pos(t - 400.f, 1800.f);
      if (phase > 700.f)
        return;
      const float span = static_cast<float>((lay.right + lay.bottom) - (lay.left + lay.top) + 12);
      p.color_mode = Pose::ColorMode::Band;
      p.band_c = static_cast<float>(lay.left + lay.top - 6) + span * (phase / 700.f);
      p.band_w = 6;
      return;
    }
    case Hold::Float: {
      const int dy = iround(2.f * std::sin(2.f * kPi * t / 1400.f));
      for (int li = 0; li < TextFit::kMaxLines; ++li)
        p.line_dy[li] = dy;
      return;
    }
    case Hold::Sparkle: {
      if (t < 400.f || lay.count == 0)
        return;
      const std::uint32_t slot = static_cast<std::uint32_t>((t - 400.f) / 250.f);
      if (fmod_pos(t - 400.f, 250.f) >= 100.f)
        return;
      p.color_mode = Pose::ColorMode::Letter;
      p.highlight_letter =
          static_cast<int>(lcg(seed * 131u + slot) % static_cast<std::uint32_t>(lay.count));
      return;
    }
    case Hold::Still:
      return;
  }
}

Pose exit_pose(Exit e, float u, const TextFit &fit, bool &gone) {
  Pose p;
  gone = true;
  switch (e) {
    case Exit::Wipe:
      p.shadow = true;
      gone = false;
      break;
    case Exit::Slide:
      p.dx = iround(200.f * ease_in_cubic(u));
      break;
    case Exit::Drop:
      p.dy = iround(170.f * ease_in_quad(u));
      break;
    case Exit::Spin:
      p.squash = std::max(0.f, 1.f - 1.25f * u);
      break;
    case Exit::Shrink:
      p.sx = std::max(0, iround(fit.scale_x * (1.f - u)));
      p.sy = std::max(0, iround(fit.scale_y * (1.f - u)));
      if (p.sx == 0 || p.sy == 0)
        p.sx = p.sy = -1;                        // gone
      break;
    case Exit::Twirl:
      p.angle = u * kPi / 2.f;
      p.factor = std::max(0.05f, 1.f - 0.95f * u);
      break;
  }
  return p;
}

void fill_diamond_at(std::uint8_t *buf, int cx, int cy, int d, std::uint8_t role) {
  if (d < 0)
    return;
  for (int y = std::max(0, cy - d); y <= std::min(kH - 1, cy + d); ++y) {
    const int r = d - std::abs(y - cy);
    const int x0 = std::max(0, cx - r);
    const int x1 = std::min(kW - 1, cx + r);
    // A diamond partly or wholly off the left/right edge yields x1 < x0; skip the
    // row rather than pass a negative length to memset (the zooming bases do this).
    if (x1 < x0)
      continue;
    std::memset(buf + y * kW + x0, role, static_cast<std::size_t>(x1 - x0 + 1));
  }
}

void draw_pose(std::uint8_t *buf, const TextFit &fit, std::uint8_t role, const Pose &p,
               int cx, int cy, Roles roles) {
  const int sx = p.sx == 0 ? fit.scale_x : p.sx;
  const int sy = p.sy == 0 ? fit.scale_y : p.sy;
  if (sx <= 0 || sy <= 0 || p.squash <= 0.f || p.factor <= 0.f)
    return;
  const Layout lay = layout_lines(fit, sx, sy, cx + p.dx, cy + p.dy);
  const int w = lay.right - lay.left;
  const int h = lay.bottom - lay.top;
  const bool transformed = !(p.squash == 1.f && p.angle == 0.f && p.factor == 1.f);
  if (!transformed || w <= 0 || w > kW || h > kRasterRows) {
    const int d = shadow_offset(sy);
    if (p.shadow) {
      for (int i = 0; i < lay.count && i < p.visible; ++i)
        draw_letter(buf, lay, i, d, d, roles.shadow, nullptr, roles);
    }
    for (int i = 0; i < lay.count && i < p.visible; ++i) {
      const int dy = p.line_dy[lay.letters[i].line] + (p.has_letter_dy ? p.letter_dy[i] : 0);
      draw_letter(buf, lay, i, 0, dy, role,
                  p.color_mode == Pose::ColorMode::None ? nullptr : &p, roles);
    }
    return;
  }

  // Rasterize the block once, then inverse-map every output pixel (nearest neighbour).
  std::memset(raster, 0, sizeof(raster));
  for (int i = 0; i < lay.count; ++i) {
    const Layout::Letter &L = lay.letters[i];
    const gen::Glyph &g = glyph_for(L.ch);
    for (int j = 0; j < gen::kFontBand; ++j) {
      for (int c = 0; c < g.advance; ++c) {
        if ((g.rows[j] & (0x8000u >> c)) == 0)
          continue;
        for (int yy = 0; yy < sy; ++yy) {
          const int ry = L.y - lay.top + j * sy + yy;
          for (int xx = 0; xx < sx; ++xx) {
            const int rx = L.x - lay.left + c * sx + xx;
            if (rx >= 0 && rx < w && ry >= 0 && ry < h)
              raster[ry * kW + rx] = 1;
          }
        }
      }
    }
  }
  const float fsx = p.squash * p.factor;
  const float fsy = p.factor;
  const float cs = std::cos(p.angle);
  const float sn = std::sin(p.angle);
  const float ocx = lay.left + w / 2.f;
  const float ocy = lay.top + h / 2.f;
  const float hx = (w * fsx * std::fabs(cs) + h * fsy * std::fabs(sn)) / 2.f + 1.f;
  const float hy = (w * fsx * std::fabs(sn) + h * fsy * std::fabs(cs)) / 2.f + 1.f;
  const int py0 = std::max(0, static_cast<int>(std::floor(ocy - hy)));
  const int py1 = std::min(kH, static_cast<int>(std::ceil(ocy + hy)));
  const int px0 = std::max(0, static_cast<int>(std::floor(ocx - hx)));
  const int px1 = std::min(kW, static_cast<int>(std::ceil(ocx + hx)));
  for (int py = py0; py < py1; ++py) {
    for (int px = px0; px < px1; ++px) {
      const float ox = px + 0.5f - ocx;
      const float oy = py + 0.5f - ocy;
      const float rx = ox * cs + oy * sn;
      const float ry = -ox * sn + oy * cs;
      const int u = static_cast<int>(std::floor(rx / fsx + w / 2.f));
      const int v = static_cast<int>(std::floor(ry / fsy + h / 2.f));
      if (u >= 0 && u < w && v >= 0 && v < h && raster[v * kW + u] != 0)
        buf[py * kW + px] = role;
    }
  }
}

}  // namespace text
}  // namespace apple::display
