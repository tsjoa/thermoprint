#include "l11_ble_printer.h"
#include "esphome/core/log.h"
#include "esphome/core/application.h"

#include <fcntl.h>
#include <esp_gap_ble_api.h>
#include <esp_gattc_api.h>

namespace esphome {
namespace l11_ble_printer {

static const char *const TAG = "l11_ble_printer";

// Minimal 8x8 standard ASCII font (characters 32-126)
static const uint8_t FONT8x8_BASIC[95][8] = {
    {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00}, // space
    {0x18,0x3C,0x3C,0x18,0x18,0x00,0x18,0x00}, // !
    {0x66,0x66,0x24,0x00,0x00,0x00,0x00,0x00}, // "
    {0x6C,0x6C,0xFE,0x6C,0xFE,0x6C,0x6C,0x00}, // #
    {0x18,0x3E,0x60,0x3C,0x06,0x7C,0x18,0x00}, // $
    {0x00,0x66,0xAC,0xD8,0x36,0x6A,0x00,0x00}, // %
    {0x38,0x6C,0x38,0x76,0xDC,0xCC,0x76,0x00}, // &
    {0x18,0x18,0x30,0x00,0x00,0x00,0x00,0x00}, // '
    {0x0C,0x18,0x30,0x30,0x30,0x18,0x0C,0x00}, // (
    {0x30,0x18,0x0C,0x0C,0x0C,0x18,0x30,0x00}, // )
    {0x00,0x66,0x3C,0xFF,0x3C,0x66,0x00,0x00}, // *
    {0x00,0x18,0x18,0x7E,0x18,0x18,0x00,0x00}, // +
    {0x00,0x00,0x00,0x00,0x00,0x18,0x18,0x30}, // ,
    {0x00,0x00,0x00,0x7E,0x00,0x00,0x00,0x00}, // -
    {0x00,0x00,0x00,0x00,0x00,0x18,0x18,0x00}, // .
    {0x06,0x0C,0x18,0x30,0x60,0xC0,0x80,0x00}, // /
    {0x3C,0x66,0x6E,0x76,0x66,0x66,0x3C,0x00}, // 0
    {0x18,0x38,0x18,0x18,0x18,0x18,0x7E,0x00}, // 1
    {0x3C,0x66,0x06,0x0C,0x18,0x30,0x7E,0x00}, // 2
    {0x3C,0x66,0x06,0x1C,0x06,0x66,0x3C,0x00}, // 3
    {0x0C,0x1C,0x3C,0x6C,0xFE,0x0C,0x0C,0x00}, // 4
    {0x7E,0x60,0x7C,0x06,0x06,0x66,0x3C,0x00}, // 5
    {0x1C,0x30,0x60,0x7C,0x66,0x66,0x3C,0x00}, // 6
    {0x7E,0x06,0x0C,0x18,0x30,0x30,0x30,0x00}, // 7
    {0x3C,0x66,0x66,0x3C,0x66,0x66,0x3C,0x00}, // 8
    {0x3C,0x66,0x66,0x3E,0x06,0x0C,0x38,0x00}, // 9
    {0x00,0x18,0x18,0x00,0x00,0x18,0x18,0x00}, // :
    {0x00,0x18,0x18,0x00,0x00,0x18,0x18,0x30}, // ;
    {0x0C,0x18,0x30,0x60,0x30,0x18,0x0C,0x00}, // <
    {0x00,0x00,0x7E,0x00,0x7E,0x00,0x00,0x00}, // =
    {0x30,0x18,0x0C,0x06,0x0C,0x18,0x30,0x00}, // >
    {0x3C,0x66,0x06,0x0C,0x18,0x00,0x18,0x00}, // ?
    {0x3C,0x66,0x6E,0x6E,0x60,0x62,0x3C,0x00}, // @
    {0x18,0x3C,0x66,0x66,0x7E,0x66,0x66,0x00}, // A
    {0x7C,0x66,0x66,0x7C,0x66,0x66,0x7C,0x00}, // B
    {0x3C,0x66,0x60,0x60,0x60,0x66,0x3C,0x00}, // C
    {0x78,0x6C,0x66,0x66,0x66,0x6C,0x78,0x00}, // D
    {0x7E,0x60,0x60,0x7C,0x60,0x60,0x7E,0x00}, // E
    {0x7E,0x60,0x60,0x7C,0x60,0x60,0x60,0x00}, // F
    {0x3C,0x66,0x60,0x6E,0x66,0x66,0x3C,0x00}, // G
    {0x66,0x66,0x66,0x7E,0x66,0x66,0x66,0x00}, // H
    {0x7E,0x18,0x18,0x18,0x18,0x18,0x7E,0x00}, // I
    {0x0E,0x06,0x06,0x06,0x06,0x66,0x3C,0x00}, // J
    {0x66,0x6C,0x78,0x70,0x78,0x6C,0x66,0x00}, // K
    {0x60,0x60,0x60,0x60,0x60,0x60,0x7E,0x00}, // L
    {0x63,0x77,0x7F,0x6B,0x63,0x63,0x63,0x00}, // M
    {0x66,0x76,0x7E,0x7E,0x6E,0x66,0x66,0x00}, // N
    {0x3C,0x66,0x66,0x66,0x66,0x66,0x3C,0x00}, // O
    {0x7C,0x66,0x66,0x7C,0x60,0x60,0x60,0x00}, // P
    {0x3C,0x66,0x66,0x66,0x6E,0x3C,0x0E,0x00}, // Q
    {0x7C,0x66,0x66,0x7C,0x78,0x6C,0x66,0x00}, // R
    {0x3C,0x66,0x60,0x3C,0x06,0x66,0x3C,0x00}, // S
    {0x7E,0x18,0x18,0x18,0x18,0x18,0x18,0x00}, // T
    {0x66,0x66,0x66,0x66,0x66,0x66,0x3C,0x00}, // U
    {0x66,0x66,0x66,0x66,0x66,0x3C,0x18,0x00}, // V
    {0x63,0x63,0x63,0x6B,0x7F,0x77,0x63,0x00}, // W
    {0x66,0x66,0x3C,0x18,0x3C,0x66,0x66,0x00}, // X
    {0x66,0x66,0x66,0x3C,0x18,0x18,0x18,0x00}, // Y
    {0x7E,0x06,0x0C,0x18,0x30,0x60,0x7E,0x00}, // Z
    {0x3C,0x30,0x30,0x30,0x30,0x30,0x3C,0x00}, // [
    {0xC0,0x60,0x30,0x18,0x0C,0x06,0x02,0x00}, // backslash
    {0x3C,0x0C,0x0C,0x0C,0x0C,0x0C,0x3C,0x00}, // ]
    {0x18,0x3C,0x66,0x00,0x00,0x00,0x00,0x00}, // ^
    {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xFF}, // _
    {0x30,0x18,0x0C,0x00,0x00,0x00,0x00,0x00}, // `
    {0x00,0x00,0x3C,0x06,0x3E,0x66,0x3B,0x00}, // a
    {0x60,0x60,0x7C,0x66,0x66,0x66,0x7C,0x00}, // b
    {0x00,0x00,0x3C,0x66,0x60,0x66,0x3C,0x00}, // c
    {0x06,0x06,0x3E,0x66,0x66,0x66,0x3E,0x00}, // d
    {0x00,0x00,0x3C,0x66,0x7E,0x60,0x3C,0x00}, // e
    {0x1C,0x30,0x78,0x30,0x30,0x30,0x30,0x00}, // f
    {0x00,0x00,0x3B,0x66,0x66,0x3E,0x06,0x7C}, // g
    {0x60,0x60,0x7C,0x66,0x66,0x66,0x66,0x00}, // h
    {0x18,0x00,0x38,0x18,0x18,0x18,0x3C,0x00}, // i
    {0x06,0x00,0x0E,0x06,0x06,0x66,0x66,0x3C}, // j
    {0x60,0x60,0x66,0x6C,0x78,0x6C,0x66,0x00}, // k
    {0x38,0x18,0x18,0x18,0x18,0x18,0x3C,0x00}, // l
    {0x00,0x00,0x66,0x7F,0x7F,0x6B,0x63,0x00}, // m
    {0x00,0x00,0x7C,0x66,0x66,0x66,0x66,0x00}, // n
    {0x00,0x00,0x3C,0x66,0x66,0x66,0x3C,0x00}, // o
    {0x00,0x00,0x7C,0x66,0x66,0x7C,0x60,0x60}, // p
    {0x00,0x00,0x3E,0x66,0x66,0x3E,0x06,0x07}, // q
    {0x00,0x00,0x7C,0x66,0x60,0x60,0x60,0x00}, // r
    {0x00,0x00,0x3E,0x60,0x3C,0x06,0x7C,0x00}, // s
    {0x18,0x18,0x7E,0x18,0x18,0x18,0x0E,0x00}, // t
    {0x00,0x00,0x66,0x66,0x66,0x66,0x3B,0x00}, // u
    {0x00,0x00,0x66,0x66,0x66,0x3C,0x18,0x00}, // v
    {0x00,0x00,0x63,0x6B,0x7F,0x3E,0x36,0x00}, // w
    {0x00,0x00,0x66,0x3C,0x18,0x3C,0x66,0x00}, // x
    {0x00,0x00,0x66,0x66,0x66,0x3E,0x06,0x7C}, // y
    {0x00,0x00,0x7E,0x0C,0x18,0x30,0x7E,0x00}, // z
    {0x0E,0x18,0x18,0x70,0x18,0x18,0x0E,0x00}, // {
    {0x18,0x18,0x18,0x18,0x18,0x18,0x18,0x00}, // |
    {0x70,0x18,0x18,0x0E,0x18,0x18,0x70,0x00}, // }
    {0x76,0xDC,0x00,0x00,0x00,0x00,0x00,0x00}, // ~
};

void L11BlePrinter::setup() {
  ESP_LOGI(TAG, "Setting up L11 BLE Printer Gateway...");
}

void L11BlePrinter::dump_config() {
  ESP_LOGCONFIG(TAG, "L11 BLE Printer Gateway:");
  if (this->parent_ != nullptr) {
    ESP_LOGCONFIG(TAG, "  BLE Address: %s", this->parent_->address_str());
  }
  ESP_LOGCONFIG(TAG, "  TCP Server Port: %u", this->tcp_port_);
  ESP_LOGCONFIG(TAG, "  BLE Status: %s", this->status_text_.c_str());
  ESP_LOGCONFIG(TAG, "  Write Handle: 0x%04X", this->write_handle_);
}

void L11BlePrinter::init_tcp_server_() {
  struct sockaddr_in server_addr;
  this->tcp_server_fd_ = socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
  if (this->tcp_server_fd_ < 0) {
    return;
  }

  int opt = 1;
  setsockopt(this->tcp_server_fd_, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
  fcntl(this->tcp_server_fd_, F_SETFL, O_NONBLOCK);

  server_addr.sin_addr.s_addr = htonl(INADDR_ANY);
  server_addr.sin_family = AF_INET;
  server_addr.sin_port = htons(this->tcp_port_);

  if (bind(this->tcp_server_fd_, (struct sockaddr *)&server_addr, sizeof(server_addr)) != 0) {
    close(this->tcp_server_fd_);
    this->tcp_server_fd_ = -1;
    return;
  }

  if (listen(this->tcp_server_fd_, 2) != 0) {
    close(this->tcp_server_fd_);
    this->tcp_server_fd_ = -1;
    return;
  }

  ESP_LOGI(TAG, "TCP Raw Printer Server listening on port %u", this->tcp_port_);
}

void L11BlePrinter::handle_tcp_clients_() {
  if (this->tcp_server_fd_ < 0) return;

  struct sockaddr_in source_addr;
  socklen_t addr_len = sizeof(source_addr);
  int client_fd = accept(this->tcp_server_fd_, (struct sockaddr *)&source_addr, &addr_len);
  if (client_fd < 0) {
    return;
  }

  ESP_LOGI(TAG, "Incoming print connection on TCP port %u", this->tcp_port_);

  std::vector<uint8_t> buffer;
  uint8_t rx_buf[256];
  int len;
  fcntl(client_fd, F_SETFL, 0);
  struct timeval tv = { .tv_sec = 2, .tv_usec = 0 };
  setsockopt(client_fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

  while ((len = recv(client_fd, rx_buf, sizeof(rx_buf), 0)) > 0) {
    buffer.insert(buffer.end(), rx_buf, rx_buf + len);
  }
  close(client_fd);

  if (!buffer.empty()) {
    ESP_LOGI(TAG, "Received %u bytes over TCP, queuing print job...", (unsigned)buffer.size());
    this->print_raw(buffer.data(), buffer.size());
  }
}

void L11BlePrinter::register_for_printer_() {
  if (this->parent_ == nullptr) return;

  std::vector<std::string> service_uuids = {
      "0000ff00-0000-1000-8000-00805f9b34fb",
      "e7810a71-73ae-499d-8c15-faa9aef0c3f2"
  };

  this->write_handle_ = 0;
  this->notify_handle_ = 0;

  for (const auto &svc_uuid : service_uuids) {
    auto *write_c = this->parent_->get_characteristic(esp32_ble_tracker::ESPBTUUID::from_raw(svc_uuid),
                                                     esp32_ble_tracker::ESPBTUUID::from_raw("0000ff02-0000-1000-8000-00805f9b34fb"));
    if (write_c == nullptr) {
      write_c = this->parent_->get_characteristic(esp32_ble_tracker::ESPBTUUID::from_raw(svc_uuid),
                                                 esp32_ble_tracker::ESPBTUUID::from_raw("bef8d6c9-9c21-4c9e-b632-bd58c1009f9f"));
    }
    auto *notify_c = this->parent_->get_characteristic(esp32_ble_tracker::ESPBTUUID::from_raw(svc_uuid),
                                                      esp32_ble_tracker::ESPBTUUID::from_raw("0000ff01-0000-1000-8000-00805f9b34fb"));

    if (write_c != nullptr) {
      this->write_handle_ = write_c->handle;
      if (notify_c != nullptr) {
        this->notify_handle_ = notify_c->handle;
      }
      ESP_LOGI(TAG, "Found Printer Service: %s (Write Handle: 0x%04X)", svc_uuid.c_str(), this->write_handle_);
      break;
    }
  }

  // If not discovered from GATT list, default to P15 handle 0x11
  if (this->write_handle_ == 0) {
    this->write_handle_ = 0x0011;
    ESP_LOGI(TAG, "Using default P15 Write Handle: 0x0011");
  }

  this->status_text_ = "READY";
  this->node_state = espbt::ClientState::ESTABLISHED;
  ESP_LOGI(TAG, "Printer is READY for print jobs on write handle 0x%04X!", this->write_handle_);
}

void L11BlePrinter::gattc_event_handler(esp_gattc_cb_event_t event, esp_gatt_if_t gattc_if,
                                        esp_ble_gattc_cb_param_t *param) {
  switch (event) {
    case ESP_GATTC_SEARCH_CMPL_EVT: {
      if (this->parent_ != nullptr && this->parent_->state() == espbt::ClientState::ESTABLISHED) {
        this->register_for_printer_();
      }
      break;
    }
    case ESP_GATTC_DISCONNECT_EVT: {
      this->write_handle_ = 0;
      this->notify_handle_ = 0;
      this->rssi_ = -127;
      if (this->tx_queue_.empty()) {
        this->status_text_ = "STANDBY";
      } else {
        this->status_text_ = "CONNECTING";
      }
      break;
    }
    default:
      break;
  }
}

void L11BlePrinter::gap_event_handler(esp_gap_ble_cb_event_t event, esp_ble_gap_cb_param_t *param) {
  if (event == ESP_GAP_BLE_READ_RSSI_COMPLETE_EVT && param != nullptr) {
    if (param->read_rssi_cmpl.status == ESP_BT_STATUS_SUCCESS) {
      this->rssi_ = param->read_rssi_cmpl.rssi;
    }
  }
}

bool L11BlePrinter::print_raw(const uint8_t *data, size_t len) {
  if (data == nullptr || len == 0) return false;

  ESP_LOGI(TAG, "Queueing raw print stream (%u bytes)...", (unsigned)len);
  for (size_t i = 0; i < len; i += 90) {
    size_t chunk_len = std::min((size_t)90, len - i);
    this->tx_queue_.push(std::vector<uint8_t>(data + i, data + i + chunk_len));
  }

  this->total_job_chunks_ = this->tx_queue_.size();
  this->sent_job_chunks_ = 0;
  this->job_finished_time_ = 0;
  if (this->parent_ != nullptr) {
    this->parent_->set_enabled(true);
  }
  return true;
}

void L11BlePrinter::process_print_queue_() {
  if (this->tx_queue_.empty()) return;
  if (!this->is_connected()) {
    uint32_t now = millis();
    if (now - this->last_chunk_sent_ > 3000) {
      this->last_chunk_sent_ = now;
      ESP_LOGW(TAG, "Waiting for printer BLE connection before sending queue (%u chunks)...", (unsigned)this->tx_queue_.size());
    }
    return;
  }

  uint32_t now = millis();
  if (now - this->last_chunk_sent_ < CHUNK_INTERVAL_MS) return;

  const auto &chunk = this->tx_queue_.front();
  esp_err_t err = esp_ble_gattc_write_char(
      this->parent_->get_gattc_if(),
      this->parent_->get_conn_id(),
      this->write_handle_,
      chunk.size(),
      const_cast<uint8_t *>(chunk.data()),
      ESP_GATT_WRITE_TYPE_NO_RSP,
      ESP_GATT_AUTH_REQ_NONE);

  if (err == ESP_OK) {
    this->tx_queue_.pop();
    this->sent_job_chunks_++;
    this->last_chunk_sent_ = now;
    this->status_text_ = "PRINTING";
    if (this->tx_queue_.empty()) {
      ESP_LOGI(TAG, "Print job completed (%u chunks streamed)!", (unsigned)this->sent_job_chunks_);
      this->status_text_ = "READY";
      this->job_finished_time_ = millis();
    }
  } else {
    ESP_LOGW(TAG, "BLE write failed, err=0x%x", err);
  }
}

float L11BlePrinter::get_progress() const {
  if (this->total_job_chunks_ == 0) return 0.0f;
  return (float)this->sent_job_chunks_ / (float)this->total_job_chunks_ * 100.0f;
}

bool L11BlePrinter::print_text(const std::string &text, float width_mm, float feed_mm, uint8_t density, bool border) {
  size_t chars_per_line = text.length();
  uint16_t min_needed = (uint16_t)(chars_per_line * 16 + 20);
  uint16_t canvas_width = (uint16_t)std::max((int)min_needed, (int)(width_mm * 8.0f));
  if (canvas_width < 120) canvas_width = 120;

  int text_pixel_width = (int)(chars_per_line * 16);
  int start_x = std::max(10, (int)(canvas_width - text_pixel_width) / 2);

  std::vector<uint8_t> payload;
  payload.reserve(canvas_width * 12);

  // Render 8x8 font scaled 2x horizontally and vertically into column-major bytes
  for (uint16_t x = 0; x < canvas_width; x++) {
    for (int y_group = 88; y_group >= 0; y_group -= 8) {
      uint8_t col_byte = 0;
      for (int bit = 0; bit < 8; bit++) {
        int py = y_group + bit;
        bool pixel = false;

        // Border
        if (border) {
          if (x <= 2 || x >= canvas_width - 3 || py <= 2 || py >= 93) {
            pixel = true;
          }
        }

        // Text rendering centered horizontally around start_x, centered vertically around py: 36..52
        if (py >= 36 && py < 52 && x >= start_x) {
          int char_idx = (x - start_x) / 16;
          int char_x = ((x - start_x) % 16) / 2;
          int char_y = (py - 36) / 2;

          if (char_idx < (int)text.length() && char_x < 8 && char_y < 8) {
            char c = text[char_idx];
            if (c >= 32 && c <= 126) {
              uint8_t font_row = FONT8x8_BASIC[c - 32][char_y];
              if ((font_row >> (7 - char_x)) & 1) {
                pixel = true;
              }
            }
          }
        }

        if (pixel) {
          col_byte |= (1 << bit);
        }
      }
      payload.push_back(col_byte);
    }
  }

  // 1. Density
  this->tx_queue_.push(std::vector<uint8_t>{0x1F, 0x70, 0x02, density});
  // 2. Init
  this->tx_queue_.push(std::vector<uint8_t>{0x10, 0xFF, 0x40});
  // 3. Wakeup & header (27 bytes)
  std::vector<uint8_t> header = {
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x10, 0xFF, 0xF1, 0x02,
      0x1D, 0x76, 0x30, 0x00,
      0x0C, 0x00,
      (uint8_t)(canvas_width & 0xFF), (uint8_t)((canvas_width >> 8) & 0xFF)
  };
  this->tx_queue_.push(header);

  // 4. Bitmap payload chunked in max 90-byte slices
  for (size_t i = 0; i < payload.size(); i += 90) {
    size_t chunk_len = std::min((size_t)90, payload.size() - i);
    this->tx_queue_.push(std::vector<uint8_t>(payload.begin() + i, payload.begin() + i + chunk_len));
  }

  // 5. Position to next gap (1D 0C)
  this->tx_queue_.push(std::vector<uint8_t>{0x1D, 0x0C});

  // 6. Stop / flush
  this->tx_queue_.push(std::vector<uint8_t>{0x10, 0xFF, 0xF1, 0x45});

  this->total_job_chunks_ = this->tx_queue_.size();
  this->sent_job_chunks_ = 0;
  this->job_finished_time_ = 0;
  if (this->parent_ != nullptr) {
    this->parent_->set_enabled(true);
  }
  ESP_LOGI(TAG, "Queued label print job (%u packets, canvas_width=%u px)", (unsigned)this->total_job_chunks_, (unsigned)canvas_width);
  return true;
}

bool L11BlePrinter::feed_to_gap() {
  ESP_LOGI(TAG, "Feeding to next label gap...");
  this->tx_queue_.push(std::vector<uint8_t>{0x1D, 0x0C});
  this->tx_queue_.push(std::vector<uint8_t>{0x10, 0xFF, 0xF1, 0x45});
  this->total_job_chunks_ = this->tx_queue_.size();
  this->sent_job_chunks_ = 0;
  this->job_finished_time_ = 0;
  if (this->parent_ != nullptr) {
    this->parent_->set_enabled(true);
  }
  return true;
}

bool L11BlePrinter::print_test_label() {
  return this->print_text("ESP32-C3 HUB OK", 38.7f, 5.0f, 3, true);
}

void L11BlePrinter::loop() {
  if (this->tcp_server_fd_ < 0) {
    this->init_tcp_server_();
  }

  // Auto-disconnect when idle
  if (this->job_finished_time_ > 0 && this->tx_queue_.empty()) {
    if (millis() - this->job_finished_time_ >= AUTO_DISCONNECT_DELAY_MS) {
      this->job_finished_time_ = 0;
      if (this->parent_ != nullptr && this->is_connected()) {
        ESP_LOGI(TAG, "Releasing BLE connection to allow other users/phones to connect.");
        this->parent_->set_enabled(false);
        this->status_text_ = "STANDBY";
      }
    }
  }

  // Active RSSI polling every 3 seconds when connected
  uint32_t now = millis();
  if (now - this->last_rssi_check_ > 3000) {
    this->last_rssi_check_ = now;
    if (this->is_connected() && this->parent_ != nullptr) {
      esp_ble_gap_read_rssi(this->parent_->get_remote_bda());
    }
  }

  this->handle_tcp_clients_();
  this->process_print_queue_();
}

}  // namespace l11_ble_printer
}  // namespace esphome
