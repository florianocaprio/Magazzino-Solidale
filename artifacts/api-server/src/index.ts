import app from "./app";
import { logger } from "./lib/logger";
import { seedRoles } from "./lib/seedRoles";
import { seedRuoliVolontari } from "./lib/seedRuoliVolontari";
import { seedTipiIntervento } from "./lib/seedTipiIntervento";
import { seedTipologieFornitore } from "./lib/seedTipologieFornitore";
import { schedulePriorityDowngrade } from "./lib/priorityDowngrade";
import { initDbExtensions } from "./lib/dbInit";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  initDbExtensions().catch((err) => {
    logger.error({ err }, "Failed to initialize DB extensions");
  });

  seedRoles().catch((err) => {
    logger.error({ err }, "Failed to seed default roles");
  });

  seedRuoliVolontari().catch((err) => {
    logger.error({ err }, "Failed to seed volunteer roles");
  });

  seedTipiIntervento().catch((err) => {
    logger.error({ err }, "Failed to seed intervention types");
  });

  seedTipologieFornitore().catch((err) => {
    logger.error({ err }, "Failed to seed supplier types");
  });

  schedulePriorityDowngrade();
});
