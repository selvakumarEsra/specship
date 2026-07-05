export interface PageProps {
  /** Selected project slug, or null to use the server's primary project. */
  project: string | null;
  param?: string;
  query: Record<string, string>;
}
