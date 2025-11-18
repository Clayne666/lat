import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";

import { SharePointClient } from "./sharepointClient.js";
import { createContactRouter } from "./routes/contact.js";
import { createCrmRouter } from "./routes/crm.js";
import { createCalculatorRouter } from "./routes/drafts.js";
import { createUsersRouter } from "./routes/users.js";
import { createAuthRouter } from "./routes/auth.js";
import { authMiddleware } from "./utils/authMiddleware.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const requiredEnv = [
  "TENANT_ID",
  "CLIENT_ID",
  "CLIENT_SECRET",
  "SHAREPOINT_SITE_ID",
  "CONTACT_LIST_ID",
  "CRM_LIST_ID",
  "CALCULATOR_LIST_ID",
  "USERS_LIST_ID",
  "AUTH_JWT_SECRET"
];

const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length) {
  console.warn(
    `⚠️  Missing environment variables: ${missing.join(
      ", "
    )}. The API will not work until they are set.`
  );
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const sharepoint = new SharePointClient({
  tenantId: process.env.TENANT_ID,
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  siteId: process.env.SHAREPOINT_SITE_ID,
  contactListId: process.env.CONTACT_LIST_ID,
  crmListId: process.env.CRM_LIST_ID,
  calculatorListId: process.env.CALCULATOR_LIST_ID,
  usersListId: process.env.USERS_LIST_ID,
  proposalLibraryPath: process.env.PROPOSAL_LIBRARY_PATH || null
});

async function bootstrapAdmin() {
  const email = process.env.DEFAULT_ADMIN_EMAIL;
  const password = process.env.DEFAULT_ADMIN_PASSWORD;
  if (!email || !password) return;
  try {
    const filter = `fields/Email eq '${email.replace(/'/g, "''")}'`;
    const existing = await sharepoint.filterItems(
      sharepoint.config.usersListId,
      filter
    );
    if (existing.value?.length) return;
    const hash = await bcrypt.hash(password, 10);
    await sharepoint.createItem(sharepoint.config.usersListId, {
      Title: email,
      Email: email.toLowerCase(),
      Role: "admin",
      Name: "Default Admin",
      PasswordHash: hash
    });
    console.log("Seeded default admin account from environment variables.");
  } catch (err) {
    console.warn("Unable to bootstrap admin user", err);
  }
}
bootstrapAdmin();

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.use("/api/auth", createAuthRouter(sharepoint));
app.use("/api/contact", createContactRouter(sharepoint));

app.use("/api/crm-records", authMiddleware, createCrmRouter(sharepoint));
app.use(
  "/api/calculator-drafts",
  authMiddleware,
  createCalculatorRouter(sharepoint)
);
app.use("/api/users", authMiddleware, createUsersRouter(sharepoint));

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || "Unexpected server error"
  });
});

const port = process.env.PORT || 5050;
app.listen(port, () => {
  console.log(`LeanAmp API listening on port ${port}`);
});
