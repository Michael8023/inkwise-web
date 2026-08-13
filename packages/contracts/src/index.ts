import { z } from 'zod';
export const documentStatus = z.enum(['local','extracting','indexing','ready','failed']);
export const documentSchema = z.object({ id:z.string(), fingerprint:z.string(), title:z.string(), pageCount:z.number(), status:documentStatus, createdAt:z.string() });
export const selectionContextSchema = z.object({ documentId:z.string().optional(), pageNumber:z.number(), text:z.string().min(1), before:z.string().optional(), after:z.string().optional() });
export const chatEventSchema = z.discriminatedUnion('type',[z.object({type:z.literal('delta'),text:z.string()}),z.object({type:z.literal('citation'),pageNumber:z.number(),quote:z.string(),chunkId:z.string()}),z.object({type:z.literal('done')}),z.object({type:z.literal('error'),message:z.string()})]);
export type Document = z.infer<typeof documentSchema>; export type SelectionContext = z.infer<typeof selectionContextSchema>; export type ChatEvent = z.infer<typeof chatEventSchema>;
