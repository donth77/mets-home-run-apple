#pragma once

// Text helpers for the 5x7 panel font: fold accents and typographic dashes.

#include <cstddef>

namespace apple::live {

// Copies UTF-8 text as ASCII: accented letters lose their accents, dashes
// become '-', and any other character outside ASCII becomes '?'.
void ascii_fold(const char* source, char* destination, std::size_t capacity);
// Upper-cases ASCII text in place.
void upper(char* text);
// Collapses runs of spaces to one, in place.
void collapse_spaces(char* text);

}  // namespace apple::live
