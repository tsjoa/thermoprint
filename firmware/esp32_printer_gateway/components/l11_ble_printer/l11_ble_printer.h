#pragma once

#include "esphome/core/component.h"
#include "esphome/core/helpers.h"
#include "esphome/components/ble_client/ble_client.h"
#include "esphome/components/esp32_ble_tracker/esp32_ble_tracker.h"

#include <vector>
#include <string>
#include <queue>
#include <lwip/sockets.h>

namespace esphome {
namespace l11_ble_printer {

namespace espbt = esphome::esp32_ble_tracker;

class L11BlePrinter : public Component, public ble_client::BLEClientNode {
 public:
  void setup() override;
  void loop() override;
  void dump_config() override;

  void set_tcp_port(uint16_t port) { this->tcp_port_ = port; }

  void gattc_event_handler(esp_gattc_cb_event_t event, esp_gatt_if_t gattc_if,
                           esp_ble_gattc_cb_param_t *param) override;

  void gap_event_handler(esp_gap_ble_cb_event_t event, esp_ble_gap_cb_param_t *param) override;

  // Print APIs
  bool print_raw(const uint8_t *data, size_t len);
  bool print_raw(const std::vector<uint8_t> &data) { return print_raw(data.data(), data.size()); }
  bool print_text(const std::string &text, float width_mm = 38.7f, float feed_mm = 5.0f, uint8_t density = 3, bool border = true);
  bool print_test_label();
  bool print_calibration_ruler(float max_mm = 50.0f);
  bool feed_to_gap();
  // Status & Telemetry
  bool is_connected() const {
    return this->parent_ != nullptr &&
           this->write_handle_ != 0 &&
           this->parent_->state() == espbt::ClientState::ESTABLISHED;
  }
  int get_rssi() const { return this->rssi_; }
  const std::string &get_status_text() const { return this->status_text_; }
  float get_progress() const;
  size_t get_queue_size() const { return this->tx_queue_.size(); }

 protected:
  void init_tcp_server_();
  void handle_tcp_clients_();
  void register_for_printer_();
  void process_print_queue_();

  uint16_t tcp_port_{9100};
  int tcp_server_fd_{-1};

  uint16_t write_handle_{0};
  uint16_t notify_handle_{0};

  int rssi_{-127};
  uint32_t last_rssi_check_{0};
  std::string status_text_{"STANDBY"};

  // Transmission queue & flow pacing
  std::queue<std::vector<uint8_t>> tx_queue_;
  size_t total_job_chunks_{0};
  size_t sent_job_chunks_{0};
  uint32_t last_chunk_sent_{0};
  uint32_t job_finished_time_{0};
  static const uint32_t CHUNK_INTERVAL_MS = 30;
  static const uint32_t AUTO_DISCONNECT_DELAY_MS = 2000;
};

}  // namespace l11_ble_printer
}  // namespace esphome
