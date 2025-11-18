import { Router } from "express";

const mapDraft = (item) => {
  let snapshot = null;
  const raw = item.fields?.Payload;
  if (raw) {
    try {
      snapshot = JSON.parse(raw);
    } catch {
      snapshot = null;
    }
  }
  return {
    id: item.id,
    title: item.fields?.Title || "Draft",
    projectName: item.fields?.ProjectName || "",
    customerName: item.fields?.CustomerName || "",
    snapshot,
    updatedAt: item.fields?.Modified
  };
};

export function createCalculatorRouter(sharepoint) {
  const router = Router();

  router.get("/", async (_req, res, next) => {
    try {
      const response = await sharepoint.listItems(
        sharepoint.config.calculatorListId
      );
      const drafts = response.value?.map(mapDraft) || [];
      res.json(drafts);
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const payload = req.body || {};
      const snapshot = payload.snapshot || payload.payload || {};
      const fields = {
        Title: payload.title || payload.projectName || "Calculator Draft",
        ProjectName: payload.projectName || "",
        CustomerName: payload.customerName || "",
        Payload: JSON.stringify(snapshot)
      };
      const item = await sharepoint.createItem(
        sharepoint.config.calculatorListId,
        fields
      );
      res.status(201).json(mapDraft(item));
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const { id } = req.params;
      const payload = req.body || {};
      const fields = { ...payload };
      if (payload.snapshot !== undefined) {
        fields.Payload = JSON.stringify(payload.snapshot || {});
      }
      await sharepoint.updateItem(sharepoint.config.calculatorListId, id, fields);
      const updated = await sharepoint.getItem(
        sharepoint.config.calculatorListId,
        id
      );
      res.json(mapDraft(updated));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      const { id } = req.params;
      await sharepoint.deleteItem(sharepoint.config.calculatorListId, id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
