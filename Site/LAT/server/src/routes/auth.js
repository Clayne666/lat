import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const mapUser = (item) => ({
  id: item.id,
  email: item.fields?.Email?.toLowerCase(),
  role: item.fields?.Role || "user",
  name: item.fields?.Name || ""
});

export function createAuthRouter(sharepoint) {
  const router = Router();
  const usersListId = sharepoint.config.usersListId;

  router.post("/login", async (req, res, next) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        const err = new Error("Email and password are required");
        err.status = 400;
        throw err;
      }
      const filter = `fields/Email eq '${email.replace(/'/g, "''")}'`;
      const response = await sharepoint.filterItems(usersListId, filter);
      const userItem = response.value?.[0];
      if (!userItem) {
        const err = new Error("Invalid credentials");
        err.status = 401;
        throw err;
      }
      const hash = userItem.fields?.PasswordHash;
      const valid = await bcrypt.compare(password, hash || "");
      if (!valid) {
        const err = new Error("Invalid credentials");
        err.status = 401;
        throw err;
      }
      const user = mapUser(userItem);
      const token = jwt.sign(
        { sub: user.email, role: user.role, name: user.name },
        process.env.AUTH_JWT_SECRET,
        { expiresIn: "2h" }
      );
      res.json({ token, user });
    } catch (err) {
      next(err);
    }
  });

  router.get("/me", (req, res, next) => {
    try {
      const authHeader = req.headers.authorization || "";
      const token = authHeader.replace("Bearer ", "");
      if (!token) {
        const err = new Error("Unauthorized");
        err.status = 401;
        throw err;
      }
      const payload = jwt.verify(token, process.env.AUTH_JWT_SECRET);
      res.json({ user: payload });
    } catch (err) {
      err.status = 401;
      next(err);
    }
  });

  return router;
}
