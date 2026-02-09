
# EClaw

**EClaw** is a lightweight, developer-friendly AI assistant framework designed to preserve the most important capabilities of large agent platforms while dramatically reducing code size and architectural complexity.

> Delivering most of the capability of large agent platforms at a fraction of the complexity.

---

## Positioning

EClaw sits between large, enterprise agent systems and ultra-minimal personal assistants:

```
Capability
   ↑
   │                                   OpenClaw
   │                             (Enterprise platform)
   │        EClaw
   │   (Balanced, practical)
   │
   │
   │
   │
   │        NanoClaw
   │     (Minimal personal)
   └──────── Low Complexity ───────── High Complexity →
```

This balance allows EClaw to provide real-world functionality while remaining maintainable and easy to understand.

---

## At a Glance

| Dimension              | OpenClaw                         | **EClaw**              | NanoClaw                 |
| ---------------------- | -------------------------------- | -------------------------- | ------------------------ |
| **Philosophy**         | Enterprise-grade platform        | **Balanced middle ground** | Minimalist personal tool |
| **Lines of Code**      | ~585K TS + Swift/Kotlin          | **~33K TS**                | ~4.3K TS                 |
| **Source Files**       | 2,232 TS + 438 Swift + 66 Kotlin | **217 TS**                 | 22 TS                    |
| **Messaging Channels** | 7 core + 30 extensions           | **7+ channels + Web UI**   | 1 (WhatsApp only)        |
| **LLM Providers**      | 20 providers                     | **Anthropic + OpenRouter** | Claude via Agent SDK     |
| **Mobile Apps**        | macOS, iOS, Android              | **None**                   | None                     |
| **Test Coverage**      | 70%+ enforced                    | **Vitest + Playwright**    | None                     |
| **Dependencies**       | 52 runtime                       | **20 runtime**             | 7 runtime                |

---


## Quick Start

### Installation

```bash
git clone https://github.com/wubo3x/eclaw.git
cd eclaw
claude
```


## Design Goals

EClaw is designed around three core principles:

### Preserve Essential Capabilities

* Multi-channel messaging
* Hybrid memory
* Browser automation
* Canvas interaction
* Voice and tools
* Scheduled tasks

---

### Reduce Complexity

* Smaller codebase
* Fewer dependencies
* Clear modular structure
* Easy debugging

---

### Improve Developer Experience

* Fast setup
* Simple configuration
* Hot reload
* Graceful degradation

---

## Who EClaw Is For

* Independent developers building agent tools
* Small teams deploying assistants
* Developers who prefer readable code
* Projects needing multi-channel automation

---

## Philosophy

EClaw aims to strike a balance between capability and simplicity:

* Powerful enough for real-world use
* Small enough to understand
* Flexible enough to extend
* Stable enough to maintain

---

## License

MIT

---

