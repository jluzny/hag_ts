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
