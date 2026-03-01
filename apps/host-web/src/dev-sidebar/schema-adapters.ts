import type {
  FormField,
  FormFieldKind,
  FormPlan,
  OperationId,
  SchemaAdapter,
} from "./contracts";
import { asRecord, asStringArray } from "./utils";

function asSelectOptions(value: unknown): Array<{ value: string; label: string; description?: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  const options: Array<{ value: string; label: string; description?: string }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.const !== "string") {
      continue;
    }
    options.push({
      value: record.const,
      label: typeof record.title === "string" ? record.title : record.const,
      ...(typeof record.description === "string"
        ? { description: record.description }
        : {}),
    });
  }

  return options;
}

function readFieldKind(schema: Record<string, unknown>): FormFieldKind {
  const type = schema.type;
  if (type === "string") {
    return "text";
  }
  if (type === "number") {
    return "number";
  }
  if (type === "integer") {
    return "integer";
  }
  if (type === "boolean") {
    return "boolean";
  }
  if (type === "array") {
    return "array";
  }
  if (type === "object") {
    return "object";
  }
  return "json";
}

function fieldFromProperty(
  key: string,
  propertySchemaRaw: unknown,
  requiredKeys: Set<string>,
): FormField {
  const propertySchema = asRecord(propertySchemaRaw);
  const enumValues = asStringArray(propertySchema.enum);
  const oneOfOptions = asSelectOptions(propertySchema.oneOf);
  const title = typeof propertySchema.title === "string" ? propertySchema.title : key;
  const baseDescription =
    typeof propertySchema.description === "string"
      ? propertySchema.description
      : undefined;
  const format = typeof propertySchema.format === "string" ? propertySchema.format : undefined;
  const description = format === "binary"
    ? `${baseDescription ? `${baseDescription} ` : ""}Binary upload is not supported in dev sidebar v1; use raw JSON mode.`
    : baseDescription;

  if (enumValues.length > 0 || oneOfOptions.length > 0) {
    return {
      key,
      label: title,
      description,
      kind: "select",
      required: requiredKeys.has(key),
      options:
        oneOfOptions.length > 0
          ? oneOfOptions
          : enumValues.map((value) => ({ value, label: value })),
    };
  }

  const kind = readFieldKind(propertySchema);
  const defaultValue = propertySchema.default;
  return {
    key,
    label: title,
    description,
    kind: kind === "array" || kind === "object" ? "json" : kind,
    required: requiredKeys.has(key),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
  };
}

const objectPropertiesAdapter: SchemaAdapter = {
  id: "object-properties",
  canAdapt(schema) {
    const record = asRecord(schema);
    const properties = asRecord(record.properties);
    return record.type === "object" && Object.keys(properties).length > 0;
  },
  adapt(schema) {
    const record = asRecord(schema);
    const properties = asRecord(record.properties);
    const required = new Set(asStringArray(record.required));
    return {
      title: typeof record.title === "string" ? record.title : undefined,
      description: typeof record.description === "string" ? record.description : undefined,
      fields: Object.entries(properties).map(([key, propertySchema]) =>
        fieldFromProperty(key, propertySchema, required)
      ),
      rawJsonFallback: true,
    };
  },
};

const rawJsonFallbackAdapter: SchemaAdapter = {
  id: "raw-json-fallback",
  canAdapt() {
    return true;
  },
  adapt(schema) {
    return {
      title: "Raw Input",
      description: "Fallback editor for schemas not supported by field adapters.",
      fields: [
        {
          key: "payload",
          label: "Input Payload",
          kind: "json",
          defaultValue: asRecord(schema).default ?? {},
        },
      ],
      rawJsonFallback: true,
    };
  },
};

export const DEFAULT_SCHEMA_ADAPTERS: SchemaAdapter[] = [
  objectPropertiesAdapter,
  rawJsonFallbackAdapter,
];

export function buildFormPlan(
  schema: unknown,
  adapters: ReadonlyArray<SchemaAdapter>,
  operationId: OperationId,
): FormPlan {
  for (const adapter of adapters) {
    if (adapter.canAdapt(schema)) {
      return adapter.adapt(schema, { operationId });
    }
  }
  return rawJsonFallbackAdapter.adapt(schema, { operationId });
}
