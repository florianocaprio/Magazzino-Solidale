import app from "./app";
import { logger } from "./lib/logger";
import { schedulePriorityDowngrade } from "./lib/priorityDowngrade";
import { initializeBaseData } from "./lib/baseData";

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

async function start(): Promise<void> {
  // A fresh deployment must not accept requests before roles, configuration,
  // modules and print defaults exist. This removes the first-start race where
  // the UI could observe a partially initialized database.
  await initializeBaseData();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");

    schedulePriorityDowngrade();
  });
}

start().catch((error) => {
  logger.fatal({ err: error }, "Failed to initialize base data");
  process.exit(1);
});
