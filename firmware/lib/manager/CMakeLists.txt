# Only the time zone table builds natively; the rest of the Manager needs the
# Arduino Wi-Fi and web server stacks.
add_library(apple_time_zones src/time_zones.cpp)
target_include_directories(apple_time_zones PUBLIC include)
target_compile_features(apple_time_zones PUBLIC cxx_std_17)
