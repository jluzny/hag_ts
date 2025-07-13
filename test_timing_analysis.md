# Test Execution Time Analysis

## Summary
Total tests analyzed: ~80+ tests
Tests sorted by execution time (slowest first)

## Critical Issues (>100ms - Immediate Action Required)

| Test Name | Time (ms) | Status | Category | Issue |
|-----------|-----------|--------|----------|-------|
| XState Home Assistant Client - Connection Management > should handle authentication failure | 1001.19 | FAIL | Integration | Network timeout (1000ms limit hit) |
| Home Assistant Integration - Error handling | 114.62 | PASS | Integration | Network/connection delays |

## High Priority (50-100ms - Optimize Soon)

| Test Name | Time (ms) | Status | Category | Issue |
|-----------|-----------|--------|----------|-------|
| HVAC State Machine Performance - XState Performance | 52.76 | FAIL | Performance | Container creation overhead |

## Medium Priority (15-50ms - Monitor)

| Test Name | Time (ms) | Status | Category | Issue |
|-----------|-----------|--------|----------|-------|
| Home Assistant Integration - Configuration integration | 18.43 | PASS | Integration | Container initialization |
| Application Container - Global Container Functions > should get global container | 18.09 | PASS | Unit | Container operations |
| HVAC Integration - Setup and basic functionality | 15.84 | PASS | Integration | System setup |
| HVAC State Machine Performance - Concurrent Operations | 15.56 | FAIL | Performance | Multiple operations |

## Low Priority (5-15ms - Acceptable)

| Test Name | Time (ms) | Status | Category | 
|-----------|-----------|--------|----------|
| XState Home Assistant Client - Connection Management > should connect successfully | 10.41 | PASS | Integration |
| Application Container - Configuration Validation > should validate complete configuration | 9.95 | PASS | Unit |
| Application Container - Basic Operations > should dispose properly | 9.84 | PASS | Unit |
| Application Container - Global Container Functions > should dispose and recreate | 9.25 | PASS | Unit |
| Application Container - Service Registration > should register configuration services | 7.35 | PASS | Unit |
| Application Container - Global Container Functions > should create global container | 6.42 | PASS | Unit |
| HVAC State Machine - Initialize correctly | 6.00 | PASS | Unit |
| Config Loader - Basic Functionality > should validate configuration file format | 5.49 | PASS | Unit |
| HVAC State Machine - Handle rapid temperature changes | 5.37 | PASS | Unit |
| Application Container - Basic Operations > should create container instance | 5.09 | PASS | Unit |

## Fast Tests (<5ms - Optimal)

| Test Name | Time (ms) | Status | Category |
|-----------|-----------|--------|----------|
| HVAC State Machine - Handle boundary conditions | 4.89 | PASS | Unit |
| Application Container - Error Handling > should handle service resolution errors | 4.76 | PASS | Unit |
| Application Container - Service Registration > should register core services | 4.24 | PASS | Unit |
| HVAC State Machine - Handle cooling scenario | 3.84 | PASS | Unit |
| HVAC State Machine - Respect active hours | 3.83 | PASS | Unit |
| HVAC State Machine - Handle manual override | 3.76 | PASS | Unit |
| HVAC State Machine - Handle outdoor temperature limits | 3.74 | PASS | Unit |
| HVAC State Machine Integration | 3.72 | PASS | Integration |
| Heating Strategy - Basic Decision Logic > should heat when indoor temperature is below minimum | 3.33 | PASS | Unit |
| HVAC State Machine - Handle defrost scenario | 3.13 | PASS | Unit |
| Configuration Validation Integration | 3.10 | PASS | Integration |

## Recommendations

### Immediate Actions (Critical Issues)
1. **Fix authentication failure test**: The 1001ms test is hitting the 1000ms timeout limit
   - Likely in `/home/jiri/dev/ha/hag_ts/tests/unit/home-assistant/client.test.ts`
   - Mock authentication calls instead of real network requests
   
2. **Optimize error handling test**: 114ms is too slow for error handling
   - Reduce network timeouts in integration tests
   - Mock external dependencies

### Short-term Optimizations (High Priority)
1. **Performance test failures**: Both performance tests are failing
   - Reduce container creation overhead
   - Use singleton pattern for test containers
   - Cache initialized containers between tests

### Medium-term Improvements
1. **Container initialization**: Multiple tests taking 15-18ms for container ops
   - Implement container caching strategy
   - Use test doubles instead of full containers where possible

### Success Stories
- Most unit tests are under 5ms (excellent performance)
- HVAC state machine tests are well-optimized
- Configuration tests are reasonably fast

## Target Goals
- **Critical**: All tests < 100ms
- **Good**: All tests < 50ms  
- **Excellent**: All tests < 10ms
- **Optimal**: Most tests < 5ms

## Current Status
- **Passing fast tests**: ~70 tests under 5ms ✅
- **Problematic tests**: 4 tests over 15ms ⚠️
- **Critical failures**: 2 tests over 50ms ❌