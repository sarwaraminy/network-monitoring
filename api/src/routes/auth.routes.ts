import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error-handler.js';
import { signAccessToken } from '../services/jwt.service.js';
import {
  authenticateUser,
  EmailAlreadyExistsError,
  existsByEmail,
  getAllUsers,
  saveUser,
  toPublicUser,
} from '../services/user.service.js';
import type { LoginResponseBody } from '../types/dto.js';

/** Replaces cyber.wissen.controller.UserController. Mounted at /auth. */
export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().min(1, 'email is required').max(200),
  password: z.string().min(1, 'password is required'),
});

const signupSchema = z.object({
  username: z.string().trim().max(200).optional(),
  email: z.string().trim().email('a valid email is required').max(200),
  password: z.string().min(8, 'password must be at least 8 characters').max(200),
  firstname: z.string().trim().min(1, 'firstname is required').max(50),
  lastname: z.string().trim().max(50).optional().default(''),
  role: z.enum(['USER', 'ADMIN']).default('USER'),
  langCode: z.string().trim().min(1).max(10).default('en'),
});

/**
 * GET /auth/users
 *
 * The Java version was unauthenticated and serialised the whole User entity,
 * including every bcrypt hash. It now requires an ADMIN token and returns
 * password-free records.
 */
authRouter.get(
  '/users',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    const users = await getAllUsers();
    res.json(users.map(toPublicUser));
  }),
);

/** POST /auth/signup */
authRouter.post(
  '/signup',
  asyncHandler(async (req, res) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
    }
    const input = parsed.data;

    if (await existsByEmail(input.email)) {
      throw new HttpError(409, 'Email is already in use.');
    }

    try {
      const user = await saveUser({
        email: input.email,
        password: input.password,
        role: input.role,
        langCode: input.langCode,
        firstname: input.firstname,
        lastname: input.lastname,
      });
      res.status(201).json(toPublicUser(user));
    } catch (error) {
      if (error instanceof EmailAlreadyExistsError) {
        throw new HttpError(409, 'Email is already in use.');
      }
      throw error;
    }
  }),
);

/**
 * POST /auth/login
 *
 * Response body keeps the old LoginResponse fields and adds `token`. The
 * `Authorization` response header is still set for any client that reads it.
 */
authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
    }
    const { email, password } = parsed.data;

    const user = await authenticateUser(email, password);
    if (!user) {
      throw new HttpError(401, 'Invalid email or password');
    }

    const token = signAccessToken({ sub: user.email ?? email, uid: user.id, role: user.role });

    const body: LoginResponseBody = {
      id: user.id,
      email: user.email,
      firstName: user.firstname,
      lastName: user.lastname,
      role: user.role,
      token,
    };

    res.setHeader('Authorization', `Bearer ${token}`);
    res.json(body);
  }),
);

/** GET /auth/me — lets the UI validate a stored token on reload. */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(toPublicUser(req.user!));
  }),
);
