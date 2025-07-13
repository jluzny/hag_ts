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
