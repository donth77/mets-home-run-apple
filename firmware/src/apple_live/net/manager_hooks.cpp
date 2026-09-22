#include "apple_live/net/manager_hooks.hpp"

#include "apple_live/audio/library_api.hpp"
#include "apple_live/display/celebration.hpp"
#include "apple_live/game/replay.hpp"
#include "apple_live/motion/motion.hpp"
#include "apple_live/net/updates.hpp"
#include "apple_live/net/wifi.hpp"
#include "apple_live/owner/owner_settings.hpp"
#include "apple_live/system/clock.hpp"
#include "apple_live/system/status.hpp"
#include "apple_live/system/text.hpp"
#include "apple_live/system/trace.hpp"

#include <Arduino.h>

#include <algorithm>

namespace apple::live {

apple::firmware::ManagerServer manager;

void start_manager() {
  manager.set_admin_code(credentials.setup_key());
  manager.begin(fill_status, on_join_request, on_forget_request, on_settings);
  manager.set_update_hooks(update_gate, on_update_done);
  manager.set_restart_hook(on_restart_request);
  manager.set_release_hooks(on_check_request, on_install_request);
  manager.set_audio_hooks(change_audio, begin_audio_upload, write_audio_upload,
                          end_audio_upload);
  manager.set_audio_file_hook(open_audio_file);
  // Tests require an authenticated session confirmed by the physical button.
  manager.set_maintenance_gate([]() -> String {
    if (!engine || engine->fault_latched() || celebration_active || !motion_idle() ||
        replay_active || actuator.busy() || actuator.estimated_position_mm(now_ms()) != 0 ||
        manager.update_in_progress()) return "BUSY";
    return String();
  });
  manager.set_fixture_hooks(start_lab_fixture, stop_lab_fixture);
  manager.set_events_hook(fill_events);
  manager.set_library_hook(write_audio_library);
  manager.set_replay_hook([](const apple::firmware::ManagerServer::ReplayRequest& request) -> String {
    if (celebration_active) return "CELEBRATING";
    if (!engine || engine->fault_latched() || manager.update_in_progress()) return "BUSY";
    if (!motion_idle() || replay_active || actuator.busy() || actuator.estimated_position_mm(now_ms()) != 0) return "BUSY";
    const bool win = request.kind == "win";
    replay_score.active = win && request.away.length() > 0 && request.home.length() > 0 &&
                          request.away_runs >= 0 && request.home_runs >= 0;
    if (replay_score.active) {
      ascii_fold(request.away.c_str(), replay_score.away, sizeof(replay_score.away));
      ascii_fold(request.home.c_str(), replay_score.home, sizeof(replay_score.home));
      replay_score.away_runs = static_cast<unsigned>(std::min(request.away_runs, 99));
      replay_score.home_runs = static_cast<unsigned>(std::min(request.home_runs, 99));
      replay_score.mets_home = request.mets_home;
      ascii_fold(request.venue.c_str(), replay_score.venue, sizeof(replay_score.venue));
      ascii_fold(request.away_name.c_str(), replay_score.away_name, sizeof(replay_score.away_name));
      ascii_fold(request.home_name.c_str(), replay_score.home_name, sizeof(replay_score.home_name));
    }
    start_replay(win);
    return String();
  });
}

}  // namespace apple::live
