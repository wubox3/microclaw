// A2UI component protocol types

export type A2uiComponent = {
  readonly type: string;
  readonly id?: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly children?: readonly A2uiComponent[];
};

export type A2uiMessage =
  | { readonly kind: "beginRendering"; readonly surfaceId: string }
  | { readonly kind: "surfaceUpdate"; readonly surfaceId: string; readonly root: A2uiComponent }
  | { readonly kind: "dataModelUpdate"; readonly surfaceId: string; readonly data: Readonly<Record<string, unknown>> }
  | { readonly kind: "deleteSurface"; readonly surfaceId: string };

// Server → Client WebSocket messages

export type CanvasOutboundMessage =
  | { readonly type: "canvas_present" }
  | { readonly type: "canvas_hide" }
  | { readonly type: "canvas_update"; readonly html: string }
  | { readonly type: "canvas_eval"; readonly code: string }
  | { readonly type: "canvas_a2ui"; readonly messages: readonly A2uiMessage[] }
  | { readonly type: "canvas_a2ui_reset" };

// Client → Server WebSocket messages

export type CanvasActionMessage = {
  readonly type: "canvas_action";
  readonly action: string;
  readonly componentId?: string;
  readonly value?: unknown;
  readonly surfaceId?: string;
};

// Canvas state tracking (immutable via ref pattern)

export type CanvasState = {
  readonly visible: boolean;
  readonly surfaces: ReadonlyMap<string, A2uiComponent>;
  readonly lastHtml: string | null;
};

export type CanvasStateRef = {
  get: () => CanvasState;
  update: (fn: (state: CanvasState) => CanvasState) => CanvasState;
};

export function createCanvasState(): CanvasStateRef {
  let state: CanvasState = {
    visible: false,
    surfaces: new Map(),
    lastHtml: null,
  };

  return {
    get: () => state,
    update: (fn) => {
      state = fn(state);
      return state;
    },
  };
}
