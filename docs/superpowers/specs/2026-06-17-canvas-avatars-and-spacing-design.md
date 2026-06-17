# Canvas: аватары, двухстрочные имена и тройное расстояние

Дата: 2026-06-17

## Задача

Переработать отображение персонажей и их связей на canvas (`web/src/canvas/MindMap.tsx`):

1. Расстояние между персонажами по умолчанию — в 3 раза больше текущего.
2. Вместо простого закрашенного круга показывать аватар персонажа.
3. Имя и фамилию показывать в две строки, в такой же плашке, в какой отображается связь между персонажами.

## Контекст (как есть сейчас)

- Узлы рисуются как круги с `background-color` по полу (`GENDER_COLORS`), подпись — одна строка `firstName lastName` под узлом, без фона.
- Рёбра (связи) уже имеют «плашку»: белый фон, `text-background-opacity: 1`, паддинг.
- Уже существует компонент `web/src/components/Avatar.tsx` — схематичный SVG-силуэт: круг цвета пола, голова и плечи светлым, размер головы зависит от возрастной стадии (`ageStage`). На canvas он не используется.
- `graphAdapter.toElements` кладёт в узел поля `label`, `avatar` (ключ вида `male-adult`), `gender`.
- Расстояние задаётся cola-layout без явных параметров (используются дефолты cola).
- Тесты `web/src/lib/__tests__/graphAdapter.test.ts` проверяют `label === "Вася В"` (через пробел) и `avatar === "male-adult"`.

## Решения (подтверждено пользователем)

- Аватар = существующий схематичный SVG-силуэт (пол + возраст). Загрузки реальных фото нет, модель данных не меняется.
- Тройное расстояние применяется только к авто-layout. Сохранённые координаты (`posX`/`posY`) не масштабируются — карты, расставленные вручную, остаются как есть.

## Дизайн

### 1. Аватар на canvas (переиспользование SVG)

- Вынести разметку силуэта из `Avatar.tsx` в чистую функцию `avatarSvgMarkup(gender, age): string` (новый файл `web/src/lib/avatarSvg.ts`), возвращающую строку `<svg …>…</svg>`.
- `Avatar.tsx` рендерит эту же разметку (через `dangerouslySetInnerHTML` или сохранив JSX, но вызывая общую функцию для canvas) — силуэт не дублируется. Атрибуты для тестов (`data-testid="avatar"`, `data-avatar`, `aria-label`) сохраняются.
- В `graphAdapter.ts` добавить узлу поле `avatarUri = "data:image/svg+xml," + encodeURIComponent(markup)`. Поле `avatar` (`"male-adult"`) оставить без изменений.
- В `MindMap.tsx` стиль узла: `background-image: data(avatarUri)`, `background-fit: "cover"`, круглая форма (ellipse по умолчанию). Цвет по полу остаётся фоном-фолбэком, добавить лёгкую рамку. Существующий sync-эффект уже копирует мутабельные поля, поэтому смена пола/возраста обновит и `avatarUri`.

### 2. Имя и фамилия в две строки в плашке

- `label` узла: `[firstName, lastName].filter(Boolean).join("\n")` — если фамилии нет, только имя (без пустой второй строки).
- Стиль узла: `text-wrap: "wrap"`, подпись под аватаром, плюс плашка как у рёбер: `text-background-color: "#ffffff"`, `text-background-opacity: 1`, `text-background-padding`, `text-background-shape: "roundrectangle"`.
- Обновить тесты `graphAdapter.test.ts` под двухстрочный label.

### 3. Расстояние ×3 (только авто-layout)

- В cola-layout задать явные `edgeLength` и `nodeSpacing` через константу `SPACING_FACTOR = 3` от базового значения, чтобы расстояние было примерно втрое больше текущего дефолта.
- Сохранённые `posX`/`posY` не трогать. Значения подобрать визуально при проверке.

## Затрагиваемые файлы

- `web/src/lib/avatarSvg.ts` (новый)
- `web/src/components/Avatar.tsx`
- `web/src/lib/graphAdapter.ts`
- `web/src/canvas/MindMap.tsx`
- `web/src/lib/__tests__/graphAdapter.test.ts` (правка)
- `web/src/lib/__tests__/avatarSvg.test.ts` (новый, небольшой)

## Тестирование

- Unit: `avatarSvgMarkup` возвращает SVG-строку с ожидаемым цветом по полу и размером головы по возрасту; `graphAdapter` отдаёт двухстрочный label и непустой `avatarUri` (data-URI).
- Существующие тесты `Avatar.test.tsx` остаются зелёными (атрибуты сохранены).
- Визуальная проверка canvas: круглые аватары, двухстрочные имена в белой плашке, увеличенное расстояние на свежей карте.
