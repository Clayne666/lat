import { Router } from "express";

export function createContactRouter(sharepoint) {
  const router = Router();

  router.post("/", async (req, res, next) => {
    try {
      const { name, company, email, topic, message } = req.body || {};
      if (!name || !email || !message) {
        const err = new Error("Name, email, and message are required");
        err.status = 400;
        throw err;
      }
      const fields = {
        Title: topic || "Website Contact",
        Name: name,
        Company: company || "",
        Email: email,
        Topic: topic || "General Inquiry",
        Message: message,
        Source: "Website"
      };
      const item = await sharepoint.createItem(
        sharepoint.config.contactListId,
        fields
      );
      res.status(201).json({ id: item?.id, fields: item?.fields });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
