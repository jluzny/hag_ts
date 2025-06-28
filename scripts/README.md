# HAG Helper Scripts

This directory contains debugging and testing scripts for the HAG (Home Assistant aGentic HVAC Automation) system.

## Available Scripts

### 🔧 `test_ha_connection.ts`
**Comprehensive connection test script**
- Tests both REST API and WebSocket connectivity
- Lists available temperature sensors
- Validates authentication flow
- **Usage**: `deno run --allow-net --allow-read --allow-env --allow-write scripts/test_ha_connection.ts`

### 🌡️ `test_sensors.ts`
**Temperature sensor availability test**
- Tests specific temperature sensors configured in the system
- Useful for verifying sensor entity IDs are correct
- **Usage**: `deno run --allow-net --allow-read --allow-env --allow-write scripts/test_sensors.ts`

### 📊 `list_entities.ts`
**Home Assistant entity discovery**
- Lists available entities by type (sensor, climate, weather)
- Filters for temperature-related entities
- Useful for finding correct sensor names
- **Usage**: `deno run --allow-net --allow-read --allow-env --allow-write scripts/list_entities.ts`

### 🌐 `test_rest_api.ts`
**Direct REST API testing**
- Tests Home Assistant REST API calls without using HAG client
- Useful for debugging REST API URL construction and authentication
- **Usage**: `deno run --allow-net --allow-env scripts/test_rest_api.ts`

### 🔌 `debug_websocket.ts`
**WebSocket connection debugging**
- Step-by-step WebSocket connection and authentication testing
- Shows connection stats and sensor data access
- **Usage**: `deno run --allow-net --allow-read --allow-env --allow-write scripts/debug_websocket.ts`

## Quick Reference

All scripts are executable and can be run directly:

```bash
# Make scripts executable (already done)
chmod +x scripts/*.ts

# Run any script directly
./scripts/test_ha_connection.ts
./scripts/debug_websocket.ts
```

## Environment Requirements

These scripts require the same environment variables as the main HAG application:

- `HASS_HassOptions__Token` - Home Assistant long-lived access token
- Valid `config/hvac_config.yaml` configuration file

## Troubleshooting

1. **Connection Issues**: Run `test_ha_connection.ts` first
2. **Sensor Not Found**: Use `list_entities.ts` to discover available sensors
3. **Authentication Problems**: Check `debug_websocket.ts` for detailed auth flow
4. **REST API Issues**: Use `test_rest_api.ts` to test direct API calls

## Example Output

```bash
$ ./scripts/test_ha_connection.ts
🏠 Home Assistant Connection Test

📡 Testing REST API directly...
✅ REST API working - Found 13 temperature sensors
   sensor.1st_floor_hall_multisensor_temperature: 24.7 °C
   sensor.openweathermap_temperature: 20.13 °C

🔌 Testing WebSocket connection...
✅ WebSocket connected and authenticated
✅ sensor.1st_floor_hall_multisensor_temperature: 24.7 °C
✅ sensor.openweathermap_temperature: 20.13 °C
✅ WebSocket disconnected cleanly

🎯 Connection test complete
```