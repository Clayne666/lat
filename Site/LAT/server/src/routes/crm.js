import { Router } from "express";

function parseSnapshot(item) {
  const raw = item?.fields?.Payload;
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn("Unable to parse CRM snapshot payload", err);
    return [];
  }
}

export function createCrmRouter(sharepoint) {
  const router = Router();
  const listId = sharepoint.config.crmListId;

  async function readSnapshot() {
    const response = await sharepoint.listItems(listId);
    const item = response.value?.[0];
    if (!item) {
      return { id: null, data: [] };
    }
    return { id: item.id, data: parseSnapshot(item) };
  }

  router.get("/", async (_req, res, next) => {
    try {
      const snapshot = await readSnapshot();
      res.json(snapshot.data);
    } catch (err) {
      next(err);
    }
  });

  router.put("/", async (req, res, next) => {
    try {
      if (!Array.isArray(req.body)) {
        const err = new Error("Payload must be an array of CRM records");
        err.status = 400;
        throw err;
      }
      const snapshot = await readSnapshot();
      const payload = {
        Title: "CRM Snapshot",
        Payload: JSON.stringify(req.body)
      };
      if (snapshot.id) {
        await sharepoint.updateItem(listId, snapshot.id, payload);
      } else {
        await sharepoint.createItem(listId, payload);
      }
      res.json(req.body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
