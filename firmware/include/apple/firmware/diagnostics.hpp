#pragma once

#include <cstdint>

namespace apple::firmware {

void run_boot_diagnostics();
void service_diagnostics(std::uint32_t now_ms);

}  // namespace apple::firmware
