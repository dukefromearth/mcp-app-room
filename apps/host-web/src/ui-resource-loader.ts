interface ResourceMetaContainer {
  _meta?: { ui?: unknown };
  meta?: { ui?: unknown };
}

interface UiResourceMeta<TCsp, TPermissions> {
  csp?: TCsp;
  permissions?: TPermissions;
}

export interface UiResourceData<TCsp, TPermissions> {
  html: string;
  csp?: TCsp;
  permissions?: TPermissions;
}

interface LoadUiResourceOptions<TCsp, TPermissions> {
  uri: string;
  expectedMimeType: string;
  readResource: (uri: string) => Promise<{
    contents: Array<{
      mimeType?: string;
      text?: string;
      blob?: string;
      _meta?: { ui?: unknown };
      meta?: { ui?: unknown };
    }>;
  } | null | undefined>;
  listingResource?: ResourceMetaContainer;
  parseUiMeta: (
    rawMeta: unknown,
    level: "content-level" | "listing-level",
  ) => UiResourceMeta<TCsp, TPermissions> | undefined;
  log: { info: (...args: unknown[]) => void };
}

function readUiResourceMetaCandidate(resource: ResourceMetaContainer | undefined): unknown {
  return resource?._meta?.ui ?? resource?.meta?.ui;
}

export async function loadUiResource<TCsp, TPermissions>({
  uri,
  expectedMimeType,
  readResource,
  listingResource,
  parseUiMeta,
  log,
}: LoadUiResourceOptions<TCsp, TPermissions>): Promise<UiResourceData<TCsp, TPermissions>> {
  log.info("Reading UI resource:", uri);
  const resource = await readResource(uri);

  if (!resource) {
    throw new Error(`Resource not found: ${uri}`);
  }

  if (resource.contents.length !== 1) {
    throw new Error(`Unexpected contents count: ${resource.contents.length}`);
  }

  const content = resource.contents[0];
  if (content.mimeType !== expectedMimeType) {
    throw new Error(`Unsupported MIME type: ${content.mimeType}`);
  }

  const html = "blob" in content && content.blob ? atob(content.blob) : content.text;
  if (typeof html !== "string") {
    throw new Error(`UI resource ${uri} did not include text payload`);
  }

  const contentMeta = parseUiMeta(
    readUiResourceMetaCandidate(content),
    "content-level",
  );
  const listingMeta = parseUiMeta(
    readUiResourceMetaCandidate(listingResource),
    "listing-level",
  );
  const uiMeta = contentMeta ?? listingMeta;

  return { html, csp: uiMeta?.csp, permissions: uiMeta?.permissions };
}
