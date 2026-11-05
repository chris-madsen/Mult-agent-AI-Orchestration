# AI-assisted SDLC: reusable instructions and ACE integration

Этот каталог содержит рабочие Markdown-инструкции, подготовленные на основе [видео об AI-assisted SDLC](https://www.youtube.com/watch?v=7oRBHxMvWxQ) и дополненные для практического использования. Это **не официальный архив файлов автора**; материалы отредактированы и расширены. Все инструкции можно читать как самостоятельные рабочие документы.

## Навигация

- [source/commands/](source/commands/) — 8 команд: исследование, проектирование, исправление ошибок, реализация backend/frontend.
- [source/agents/](source/agents/) — 4 инструкции по исследованию, архитектуре, рискам изменений и трассировке дефектов.
- [source/standards/](source/standards/) — 10 прикладных стандартов; Go-специфичные детали не обязательны для ACE.
- [source/examples/user-avatar/](source/examples/user-avatar/) — пример пакета документов фичи: архитектура, поведение, решения, тесты, события, модели, API.
- [source/examples/user-avatar/plan/](source/examples/user-avatar/plan/) — пример 8 последовательных фаз с зависимостями и проверками.
- [source/templates/](source/templates/) — reusable research report, context checkpoint, manual QA и phase template.
- [ACE-SINGLE-AGENT-SDLC.md](ACE-SINGLE-AGENT-SDLC.md) — как перенести метод в ACE с **одним** агентом.
- [PROMPTS-ACE.md](PROMPTS-ACE.md) — промпты Research/Design/Plan/Implement/Review/Checkpoint для любого coding agent.
- [ADOPTION-PLAN.md](ADOPTION-PLAN.md) — последовательность внедрения без дублирования OpenSpec и CI.
- [REPORT.md](REPORT.md) — фактический статус GitHub-изменений.

## Приоритеты ACE

1. Корневой `AGENTS.md`, принятые ADR и OpenSpec — источник обязательных правил.
2. Инструкции здесь — вспомогательный материал; они **не переопределяют** требования к безопасности, качеству или релизу ACE.
3. Для работы используйте [операционный SDLC](../../operations/ai-assisted-sdlc.md); это единая точка входа.
4. Одна модель выполняет роли последовательно; её самопроверка не заменяет независимую проверку человеком.
5. Сохранены конкретные процедуры: фактическое исследование с `path:line`, C4/DFD/sequence при необходимости, фазы и четыре проверки build/architecture/security/plan.
