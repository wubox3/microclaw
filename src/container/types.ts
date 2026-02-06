export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  channelId: string;
  chatId?: string;
}

export interface ContainerOutput {
  status: "success" | "error";
  result: string | null;
  newSessionId?: string;
  error?: string;
}

export interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly?: boolean;
}

export interface AdditionalMount {
  hostPath: string;
  containerPath: string;
  readonly?: boolean;
}

export interface MountAllowlist {
  allowedRoots: AllowedRoot[];
  blockedPatterns: string[];
  nonMainReadOnly: boolean;
}

export interface AllowedRoot {
  path: string;
  allowReadWrite: boolean;
  description?: string;
}

export interface ContainerConfig {
  enabled?: boolean;
  image?: string;
  timeout?: number;
  additionalMounts?: AdditionalMount[];
}
