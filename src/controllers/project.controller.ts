import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/error";
import type {
  CreateProjectInput,
  UpdateProjectInput,
} from "../schemas/project.schema";

export async function listProjects(_req: Request, res: Response) {
  const projects = await prisma.project.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { tasks: true, reports: true } } },
  });
  res.json({ projects });
}

export async function getProject(req: Request, res: Response) {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
  });
  if (!project) throw new AppError(404, "ไม่พบโปรเจกต์");
  res.json({ project });
}

export async function createProject(req: Request, res: Response) {
  const data = req.body as CreateProjectInput;
  const project = await prisma.project.create({ data });
  res.status(201).json({ project });
}

export async function updateProject(req: Request, res: Response) {
  const data = req.body as UpdateProjectInput;
  const project = await prisma.project.update({
    where: { id: req.params.id },
    data,
  });
  res.json({ project });
}

export async function deleteProject(req: Request, res: Response) {
  await prisma.project.delete({ where: { id: req.params.id } });
  res.status(204).send();
}
