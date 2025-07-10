# HVAC Prompts

This file contains a collection of prompts used to test the HAG HVAC automation
application.

---

## Prompt 1: Turn off all HVAC units, wait, then run the app and validate

**Description:** This prompt tests the application's ability to start up, read
the current state of the HVAC system, and take appropriate action. It first
turns off all HVAC units, waits for 10 seconds, then runs the application for 10
seconds. Finally, it validates that the application correctly turns on the
cooling system by checking the state of the HVAC units in Home Assistant.

**Prompt:**

```
turn off all Hvac units; wait 5 sec.; now run the app, set 10 sec timeout to stop the app with KILL signal; based on the log describe app logic behavior step by step, and validate if the reported result corresponds to live state in hass (using rest api and configuration from ./config dir)
```
