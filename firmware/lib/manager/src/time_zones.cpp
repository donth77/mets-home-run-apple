#include "apple/firmware/time_zones.hpp"

#include <cstring>

namespace apple::firmware {
namespace {

// Labels follow the CLDR "generic zone name - exemplar city" form that phone
// and desktop pickers use ("Eastern Time - New York"). Aliases carry the
// other IANA ids sharing the clock plus the everyday abbreviations; where an
// abbreviation is ambiguous worldwide (CST, IST, AST) the North American or
// most common reading wins, since owners type what they see on a schedule.
// POSIX abbreviations must be letters only: the clock library rejects "+01"
// style names and the display prints them after the game time.
constexpr TimeZoneInfo kZones[] = {
    {"America/New_York", "Eastern Time - New York", "EST5EDT,M3.2.0,M11.1.0",
     "ET EST EDT US/Eastern America/Detroit America/Toronto America/Montreal America/Nassau "
     "America/Indiana/Indianapolis America/Kentucky/Louisville America/Kentucky/Monticello "
     "America/Indiana/Vincennes America/Indiana/Petersburg America/Indiana/Winamac "
     "America/Indiana/Marengo America/Indiana/Vevay America/Iqaluit America/Nipigon "
     "America/Thunder_Bay America/Grand_Turk America/Port-au-Prince"},
    {"America/Chicago", "Central Time - Chicago", "CST6CDT,M3.2.0,M11.1.0",
     "CT CST CDT US/Central America/Winnipeg America/Indiana/Knox America/Indiana/Tell_City "
     "America/Menominee America/North_Dakota/Center America/North_Dakota/New_Salem "
     "America/North_Dakota/Beulah America/Rainy_River America/Rankin_Inlet America/Resolute "
     "America/Matamoros America/Ojinaga"},
    {"America/Denver", "Mountain Time - Denver", "MST7MDT,M3.2.0,M11.1.0",
     "MT MST MDT US/Mountain America/Edmonton America/Boise America/Yellowknife "
     "America/Cambridge_Bay America/Inuvik America/Ciudad_Juarez"},
    {"America/Phoenix", "Mountain Time, no daylight saving - Phoenix", "MST7",
     "Arizona US/Arizona America/Creston America/Dawson_Creek America/Fort_Nelson "
     "America/Hermosillo America/Whitehorse America/Dawson"},
    {"America/Los_Angeles", "Pacific Time - Los Angeles", "PST8PDT,M3.2.0,M11.1.0",
     "PT PST PDT US/Pacific America/Vancouver America/Tijuana"},
    {"America/Anchorage", "Alaska Time - Anchorage", "AKST9AKDT,M3.2.0,M11.1.0",
     "AKT AKST AKDT US/Alaska America/Juneau America/Sitka America/Metlakatla America/Yakutat "
     "America/Nome"},
    {"America/Adak", "Hawaii-Aleutian Time - Adak", "HST10HDT,M3.2.0,M11.1.0", "US/Aleutian"},
    {"Pacific/Honolulu", "Hawaii Time - Honolulu", "HST10", "HST US/Hawaii Pacific/Johnston"},
    {"America/Halifax", "Atlantic Time - Halifax", "AST4ADT,M3.2.0,M11.1.0",
     "AT AST ADT America/Glace_Bay America/Moncton America/Goose_Bay Atlantic/Bermuda America/Thule"},
    {"America/St_Johns", "Newfoundland Time - St. John's", "NST3:30NDT,M3.2.0,M11.1.0",
     "NT NST NDT"},
    {"America/Puerto_Rico", "Atlantic Time, no daylight saving - San Juan", "AST4",
     "America/Santo_Domingo America/Barbados America/Martinique America/Port_of_Spain "
     "America/Curacao America/Aruba America/St_Thomas America/Antigua America/Dominica "
     "America/Grenada America/Guadeloupe America/St_Kitts America/St_Lucia America/St_Vincent "
     "America/Tortola America/Anguilla America/Montserrat America/Blanc-Sablon"},
    {"America/Mexico_City", "Central Time, no daylight saving - Mexico City", "CST6",
     "America/Monterrey America/Merida America/Bahia_Banderas America/Guatemala "
     "America/Costa_Rica America/El_Salvador America/Tegucigalpa America/Managua America/Belize "
     "America/Regina America/Swift_Current"},
    {"America/Bogota", "Colombia Time - Bogota", "COT5",
     "COT America/Lima America/Panama America/Jamaica America/Cancun America/Cayman "
     "America/Guayaquil America/Rio_Branco America/Eirunepe"},
    {"America/Caracas", "Venezuela Time - Caracas", "VET4",
     "VET America/La_Paz America/Manaus America/Guyana America/Boa_Vista America/Porto_Velho "
     "America/Campo_Grande America/Cuiaba"},
    {"America/Sao_Paulo", "Brasilia Time - Sao Paulo", "BRT3",
     "BRT America/Argentina/Buenos_Aires America/Buenos_Aires America/Montevideo America/Santiago "
     "America/Asuncion America/Fortaleza America/Recife America/Bahia America/Belem "
     "America/Cayenne America/Paramaribo America/Araguaina America/Maceio America/Santarem "
     "America/Punta_Arenas America/Argentina/Cordoba America/Argentina/Mendoza"},
    {"UTC", "Coordinated Universal Time - UTC", "UTC0",
     "GMT Z Etc/UTC Etc/GMT Atlantic/Reykjavik Africa/Abidjan Africa/Accra"},
    {"Europe/London", "Greenwich Mean Time - London", "GMT0BST,M3.5.0/1,M10.5.0",
     "BST Europe/Belfast Europe/Guernsey Europe/Isle_of_Man Europe/Jersey Europe/Lisbon "
     "Atlantic/Canary Atlantic/Faroe Atlantic/Madeira"},
    {"Europe/Dublin", "Greenwich Mean Time - Dublin", "GMT0IST,M3.5.0/1,M10.5.0", ""},
    {"Europe/Paris", "Central European Time - Paris", "CET-1CEST,M3.5.0,M10.5.0/3",
     "CET CEST Europe/Berlin Europe/Madrid Europe/Rome Europe/Amsterdam Europe/Brussels "
     "Europe/Vienna Europe/Zurich Europe/Stockholm Europe/Oslo Europe/Copenhagen Europe/Prague "
     "Europe/Warsaw Europe/Budapest Europe/Belgrade Europe/Zagreb Europe/Ljubljana "
     "Europe/Bratislava Europe/Luxembourg Europe/Monaco Europe/Malta Europe/Andorra "
     "Europe/Gibraltar Europe/Tirane Europe/Sarajevo Europe/Skopje Europe/Podgorica Europe/Vaduz "
     "Europe/San_Marino Europe/Vatican Europe/Busingen Africa/Ceuta Arctic/Longyearbyen"},
    {"Europe/Athens", "Eastern European Time - Athens", "EET-2EEST,M3.5.0/3,M10.5.0/4",
     "EET EEST Europe/Helsinki Europe/Kiev Europe/Kyiv Europe/Bucharest Europe/Sofia Europe/Riga "
     "Europe/Tallinn Europe/Vilnius Europe/Chisinau Asia/Nicosia Europe/Nicosia Europe/Mariehamn "
     "Europe/Uzhgorod Europe/Zaporozhye"},
    {"Europe/Moscow", "Moscow Time - Moscow", "MSK-3",
     "MSK Europe/Istanbul Asia/Istanbul Europe/Minsk Europe/Kirov Europe/Volgograd "
     "Europe/Simferopol Asia/Riyadh Asia/Baghdad Asia/Kuwait Asia/Qatar Asia/Bahrain Asia/Aden "
     "Africa/Nairobi Asia/Amman Asia/Damascus"},
    {"Asia/Jerusalem", "Israel Time - Jerusalem", "IST-2IDT,M3.4.4/26,M10.5.0", "IDT Asia/Tel_Aviv"},
    {"Asia/Dubai", "Gulf Time - Dubai", "GST-4",
     "GST Asia/Muscat Asia/Baku Asia/Tbilisi Asia/Yerevan Indian/Mauritius"},
    {"Asia/Kolkata", "India Time - Kolkata", "IST-5:30", "IST Asia/Calcutta Asia/Colombo"},
    {"Asia/Bangkok", "Indochina Time - Bangkok", "ICT-7",
     "ICT Asia/Jakarta Asia/Ho_Chi_Minh Asia/Saigon Asia/Phnom_Penh Asia/Vientiane"},
    {"Asia/Shanghai", "China Time - Shanghai", "CST-8",
     "Asia/Chongqing Asia/Harbin Asia/Urumqi Asia/Taipei Asia/Macau"},
    {"Asia/Hong_Kong", "Hong Kong Time - Hong Kong", "HKT-8", "HKT"},
    {"Asia/Singapore", "Singapore Time - Singapore", "SGT-8",
     "SGT Asia/Kuala_Lumpur Asia/Manila Australia/Perth"},
    {"Asia/Tokyo", "Japan Time - Tokyo", "JST-9", "JST"},
    {"Asia/Seoul", "Korea Time - Seoul", "KST-9", "KST"},
    {"Australia/Brisbane", "Australian Eastern Time, no daylight saving - Brisbane", "AEST-10",
     "Australia/Lindeman"},
    {"Australia/Sydney", "Australian Eastern Time - Sydney", "AEST-10AEDT,M10.1.0,M4.1.0/3",
     "AET AEST AEDT Australia/Melbourne Australia/Hobart Australia/Canberra Australia/ACT "
     "Australia/NSW Australia/Victoria Australia/Tasmania"},
    {"Australia/Adelaide", "Australian Central Time - Adelaide", "ACST-9:30ACDT,M10.1.0,M4.1.0/3",
     "ACST ACDT Australia/South Australia/Broken_Hill"},
    {"Australia/Darwin", "Australian Central Time, no daylight saving - Darwin", "ACST-9:30",
     "Australia/North"},
    {"Pacific/Auckland", "New Zealand Time - Auckland", "NZST-12NZDT,M9.5.0,M4.1.0/3",
     "NZT NZST NZDT NZ Antarctica/McMurdo"},
};

bool word_match(const char* list, const char* word) {
  if (list == nullptr || word == nullptr || word[0] == '\0') return false;
  const std::size_t n = std::strlen(word);
  const char* p = list;
  while (*p != '\0') {
    while (*p == ' ') ++p;
    const char* start = p;
    while (*p != '\0' && *p != ' ') ++p;
    if (static_cast<std::size_t>(p - start) == n && std::strncmp(start, word, n) == 0) return true;
  }
  return false;
}

}  // namespace

const TimeZoneInfo* time_zones(std::size_t& count) {
  count = sizeof(kZones) / sizeof(kZones[0]);
  return kZones;
}

const TimeZoneInfo* find_time_zone(const char* iana_id) {
  if (iana_id == nullptr || iana_id[0] == '\0') return nullptr;
  for (const TimeZoneInfo& zone : kZones) {
    if (std::strcmp(zone.id, iana_id) == 0) return &zone;
  }
  for (const TimeZoneInfo& zone : kZones) {
    if (word_match(zone.aliases, iana_id)) return &zone;
  }
  return nullptr;
}

}  // namespace apple::firmware
