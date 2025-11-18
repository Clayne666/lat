import { Router } from "express";
import bcrypt from "bcryptjs";
import { requireAdmin } from "../utils/authMiddleware.js";

const toUser = (item) => ({
  id: item.id,
  email: item.fields?.Email,
  role: item.fields?.Role || "user",
  name: item.fields?.Name || ""
});

export function createUsersRouter(sharepoint) {
  const router = Router();
  const usersListId = sharepoint.config.usersListId;

  router.get("/", requireAdmin, async (_req, res, next) => {
    try {
      const response = await sharepoint.listItems(usersListId);
      const users = response.value?.map(toUser) || [];
      res.json(users);
    } catch (err) {
      next(err);
    }
  });

  router.post("/", requireAdmin, async (req, res, next) => {
    try {
      const { email, password, role, name } = req.body || {};
      if (!email || !password) {
        const err = new Error("Email and password are required");
        err.status = 400;
        throw err;
      }
      const hash = await bcrypt.hash(password, 10);
      const fields = {
        Title: email,
        Email: email.toLowerCase(),
        Role: role || "user",
        Name: name || "",
        PasswordHash: hash
      };
      const created = await sharepoint.createItem(usersListId, fields);
      res.status(201).json(toUser(created));
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", requireAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      const updates = {};
      if (req.body.role) updates.Role = req.body.role;
      if (req.body.name) updates.Name = req.body.name;
      if (req.body.password) {
        updates.PasswordHash = await bcrypt.hash(req.body.password, 10);
      }
      await sharepoint.updateItem(usersListId, id, updates);
      const updated = await sharepoint.getItem(usersListId, id);
      res.json(toUser(updated));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id", requireAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      await sharepoint.deleteItem(usersListId, id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
