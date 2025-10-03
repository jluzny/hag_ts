# HVAC Prompts

This file contains a collection of prompts used to test the HAG HVAC automation
application.

---

## Prompt 1: Complete HVAC State Test with Restoration

**Description:** This prompt tests the application's ability to start up, read
the current state of the HVAC system, and take appropriate action. It first
captures the initial state of all HVAC units, turns them off, waits, runs the
application for 10 seconds, validates the results, and then restores the original
state.

**Prompt:**

```
Read and remember the initial state of all HVAC units from Home Assistant; turn off all HVAC units; wait 5 sec.; now run the app with 10 sec timeout to stop the app with KILL signal; based on the log describe app logic behavior step by step, and validate if the reported result corresponds to live state in HASS (using rest api and configuration from ./config dir); finally restore all HVAC units to their original remembered state and confirm restoration was successful.
```

---

## Prompt 2: After-Hours Entity Shutdown Test

**Description:** This prompt tests the new after-hours automatic shutdown logic. It verifies that enabled HVAC entities are automatically turned off when the system detects operation outside configured working hours (6:00-21:00), and that only enabled entities are affected.

**Test Scenario:**

1. Turn on enabled HVAC entities during after-hours
2. Simulate sensor change to trigger evaluation
3. Verify system automatically turns off enabled entities
4. Confirm non-enabled entities remain unaffected

**Prompt:**

```
Turn on all enabled HVAC entities using call_service script; check their status to confirm they are running; wait 2 seconds; run the sensor simulation script to trigger after-hours evaluation; check final status of all entities to verify that only enabled entities were turned off and disabled entities remained unchanged; describe the turn-off logic behavior and confirm it respects the enabled/disabled configuration.
```

---

## Prompt 3: Individual Room Cooling Control Test

**Description:** This prompt tests the new individual unit cooling control logic where each HVAC unit makes its own ON/OFF decision based on its room temperature sensor rather than using a global temperature. It validates that units turn ON when room temperature exceeds indoorMax (26°C), turn OFF when below indoorMin (23°C), and maintain state when in acceptable range.

**Test Scenario:**

1. Set different room temperatures to create mixed conditions:
   - Living room: hot (>26°C) - should turn ON cooling
   - Bedroom: cool (<23°C) - should turn OFF cooling
   - Office: comfortable (23-26°C) - should maintain current state
2. Trigger global cooling evaluation with suitable outdoor conditions
3. Verify each unit responds based on its individual room temperature
4. Confirm service calls match expected individual unit logic

**Expected Individual Unit Behavior:**

- `climate.living_room_ac`: Turn ON cooling (room temp 27.5°C > 26°C threshold)
- `climate.bedroom_ac`: Turn OFF cooling (room temp 22°C < 23°C threshold)
- `climate.office_ac`: Maintain state (room temp 24.5°C in 23-26°C range)

**Prompt:**

```
Check initial status of all HVAC units; simulate different room temperatures using call_service script: set living room to 27.5°C (hot), bedroom to 22°C (cool), and office to 24.5°C (comfortable); wait 2 seconds; run the app with 15 second timeout during active hours to trigger individual cooling evaluation; analyze the logs to identify individual unit decisions and verify each unit responded correctly based on its room temperature vs cooling thresholds (indoorMin: 23°C, indoorMax: 26°C); check final HVAC status to confirm living room turned ON cooling, bedroom turned OFF cooling, and office maintained acceptable state; describe step-by-step how the new individual unit logic worked and validate it matches expected behavior for zone-based HVAC control.
```
