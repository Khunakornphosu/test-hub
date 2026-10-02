import { asc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { projects } from '../schema.js';

export interface Project {
  id: number;
  name: string;
}

export function projectsRepo(db: Db) {
  return {
    async list(): Promise<Project[]> {
      return db.select({ id: projects.id, name: projects.name }).from(projects).orderBy(asc(projects.id));
    },
    async create(name: string): Promise<number> {
      const [row] = await db.insert(projects).values({ name }).returning({ id: projects.id });
      return row!.id;
    },
    async remove(id: number): Promise<void> {
      await db.delete(projects).where(eq(projects.id, id));
    },
  };
}
