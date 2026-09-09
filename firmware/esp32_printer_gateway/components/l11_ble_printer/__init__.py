import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.components import ble_client
from esphome.const import CONF_ID

AUTO_LOAD = ["ble_client"]
MULTI_CONF = True

CONF_TCP_PORT = "tcp_port"

l11_ble_printer_ns = cg.esphome_ns.namespace("l11_ble_printer")
L11BlePrinter = l11_ble_printer_ns.class_(
    "L11BlePrinter", cg.Component, ble_client.BLEClientNode
)

CONFIG_SCHEMA = (
    cv.Schema(
        {
            cv.GenerateID(): cv.declare_id(L11BlePrinter),
            cv.Optional(CONF_TCP_PORT, default=9100): cv.port,
        }
    )
    .extend(cv.COMPONENT_SCHEMA)
    .extend(ble_client.BLE_CLIENT_SCHEMA)
)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    await ble_client.register_ble_node(var, config)

    if CONF_TCP_PORT in config:
        cg.add(var.set_tcp_port(config[CONF_TCP_PORT]))
