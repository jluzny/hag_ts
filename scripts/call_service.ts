#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Call Home Assistant Service Script
 *
 * Calls a Home Assistant service using the REST API.
 */

// Get arguments
const [service, ...args] = Deno.args;

if (!service) {
  console.error(
    'Usage: ./call_service.ts <domain>.<service> [--entity_id <entity_id>] [key=value ...]',
  );
  Deno.exit(1);
}

const [domain, serviceName] = service.split('.');

if (!domain || !serviceName) {
  console.error('Invalid service format. Use <domain>.<service>');
  Deno.exit(1);
}

// Parse service data
const serviceData: Record<string, unknown> = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].substring(2);
    const value = args[i + 1];
    if (value && !value.startsWith('--')) {
      serviceData[key] = value;
      i++;
    } else {
      serviceData[key] = true;
    }
  } else if (args[i].includes('=')) {
    const [key, value] = args[i].split('=');
    serviceData[key] = value;
  }
}

// Home Assistant details
const token = Deno.env.get('HASS_HassOptions__Token');
const restUrl = 'http://192.168.0.204:8123/api';

try {
  console.log(
    `Calling service ${domain}.${serviceName} with data:`,
    serviceData,
  );
  const response = await fetch(`${restUrl}/services/${domain}/${serviceName}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(serviceData),
  });

  console.log(`Response status: ${response.status}`);

  if (response.ok) {
    console.log(`✅ Service ${domain}.${serviceName} called successfully.`);
  } else {
    const errorText = await response.text();
    console.log(`❌ Failed to call service: ${response.status} - ${errorText}`);
  }
} catch (error) {
  console.log(`❌ Error: ${(error as Error).message}`);
}
