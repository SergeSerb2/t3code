import {
  CompactSign,
  compactVerify,
  decodeJwt,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from "jose";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

export const RELAY_LINK_PROOF_TYP = "t3-env-link+jwt";
export const RELAY_MINT_REQUEST_TYP = "t3-cloud-mint+jwt";
export const RELAY_HEALTH_REQUEST_TYP = "t3-cloud-health+jwt";
export const RELAY_MINT_RESPONSE_TYP = "t3-env-mint+jwt";
export const RELAY_HEALTH_RESPONSE_TYP = "t3-env-health+jwt";
export const RELAY_ACTIVITY_PUBLISH_TYP = "t3-env-activity+jwt";
export const RELAY_MANAGED_TUNNEL_RECOVERY_TYP = "t3-env-managed-tunnel-recovery+jwt";
export const RELAY_HOOK_DELIVERY_TYP = "t3-relay-hook-delivery+jwt";
/** Header carrying the signed proof that a webhook request came from the relay. */
export const RELAY_HOOK_DELIVERY_HEADER = "x-t3-relay-delivery";

export class RelayJwtError extends Schema.TaggedError<RelayJwtError>()("RelayJwtError", {
  operation: Schema.Literals(["sign", "verify"]),
  typ: Schema.String,
  issuer: Schema.optional(Schema.String),
  audience: Schema.optional(Schema.String),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to ${this.operation} relay JWT of type "${this.typ}".`;
  }

  static diagnosticCode(error: RelayJwtError): string {
    if (
      Predicate.isObject(error.cause) &&
      Predicate.hasProperty(error.cause, "code") &&
      Predicate.isString(error.cause.code) &&
      error.cause.code.length > 0
    ) {
      return error.cause.code;
    }

    return error.cause instanceof Error && error.cause.name ? error.cause.name : "unknown";
  }
}

export function normalizeRelayIssuer(value: string): string {
  return value.trim().replace(/\/+$/gu, "");
}

export function decodeRelayJwt(token: string): JWTPayload {
  return decodeJwt(token);
}

function normalizePem(value: string): string {
  return value.replace(/\\n/gu, "\n").trim();
}

export function signRelayJwt(input: {
  readonly privateKey: string;
  readonly typ: string;
  readonly payload: JWTPayload;
}): Effect.Effect<string, RelayJwtError> {
  return Effect.tryPromise({
    try: async () => {
      const key = await importPKCS8(normalizePem(input.privateKey), "EdDSA");
      return new SignJWT(input.payload)
        .setProtectedHeader({ alg: "EdDSA", typ: input.typ })
        .sign(key);
    },
    catch: (cause) => new RelayJwtError({ operation: "sign", typ: input.typ, cause }),
  });
}

export function verifyRelayJwt(input: {
  readonly publicKey: string;
  readonly token: string;
  readonly typ: string;
  readonly issuer: string;
  readonly audience: string;
  readonly nowEpochSeconds: number;
  readonly maxTokenAge?: string | number;
}): Effect.Effect<JWTPayload, RelayJwtError> {
  return Effect.tryPromise({
    try: async () => {
      const key = await importSPKI(normalizePem(input.publicKey), "EdDSA");
      const verified = await jwtVerify(input.token, key, {
        algorithms: ["EdDSA"],
        typ: input.typ,
        issuer: input.issuer,
        audience: input.audience,
        maxTokenAge: input.maxTokenAge ?? "5 minutes",
        clockTolerance: 60,
        currentDate: DateTime.toDate(DateTime.makeUnsafe(input.nowEpochSeconds * 1_000)),
      });
      return verified.payload;
    },
    catch: (cause) =>
      new RelayJwtError({
        operation: "verify",
        typ: input.typ,
        issuer: input.issuer,
        audience: input.audience,
        cause,
      }),
  });
}

/** URL capability issued by the already-linked environment; no additional credential is provisioned. */
export const RELAY_HOOK_HOLD_PROOF_PARAM = "t3_hold_proof";
const RELAY_HOOK_HOLD_TYP = "t3-env-hook-hold";
const hookHoldBinding = (endpointKey: string, hookId: string, token: string) =>
  JSON.stringify([endpointKey, hookId, token]);

export const signRelayHookHoldUrl = (
  url: string,
  privateKey: string,
): Effect.Effect<string, RelayJwtError> =>
  Effect.tryPromise({
    try: async () => {
      const parsed = new URL(url);
      const segments = parsed.pathname.split("/");
      if (segments.length !== 6 || segments[1] !== "v1" || segments[2] !== "hooks")
        throw new Error("Invalid hook URL");
      const binding = hookHoldBinding(
        segments[3]!,
        decodeURIComponent(segments[4]!),
        decodeURIComponent(segments[5]!),
      );
      const key = await importPKCS8(normalizePem(privateKey), "EdDSA");
      const proof = await new CompactSign(new TextEncoder().encode(binding))
        .setProtectedHeader({ alg: "EdDSA", typ: RELAY_HOOK_HOLD_TYP })
        .sign(key);
      parsed.searchParams.set(RELAY_HOOK_HOLD_PROOF_PARAM, proof);
      return parsed.toString();
    },
    catch: (cause) => new RelayJwtError({ operation: "sign", typ: RELAY_HOOK_HOLD_TYP, cause }),
  });

export const verifyRelayHookHoldProof = (input: {
  readonly proof: string;
  readonly publicKey: string;
  readonly endpointKey: string;
  readonly hookId: string;
  readonly token: string;
}): Effect.Effect<boolean> =>
  Effect.tryPromise({
    try: async () => {
      if (input.proof.length > 4096) return false;
      const key = await importSPKI(normalizePem(input.publicKey), "EdDSA");
      const verified = await compactVerify(input.proof, key, { algorithms: ["EdDSA"] });
      return (
        verified.protectedHeader.typ === RELAY_HOOK_HOLD_TYP &&
        new TextDecoder().decode(verified.payload) ===
          hookHoldBinding(input.endpointKey, input.hookId, input.token)
      );
    },
    catch: () => false,
  }).pipe(Effect.orElseSucceed(() => false));
