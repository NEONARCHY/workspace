# Совместная разработка Yuksalish Workspace

`main` — общая, проверенная версия проекта. В неё не пушим рабочие изменения
напрямую: каждый модуль или исправление начинается в отдельной ветке и приходит
в `main` через Pull Request (PR).

## Первый запуск на компьютере разработчика

1. Владелец репозитория добавляет разработчика в GitHub-репозиторий
   `NEONARCHY/yuksalish-workspace` с ролью **Write**.
2. Разработчик устанавливает Git, Node.js 20, pnpm 10, Python 3.11 и Docker
   Desktop, затем клонирует проект:

   ```powershell
   git clone https://github.com/NEONARCHY/yuksalish-workspace.git
   Set-Location yuksalish-workspace
   pnpm install --frozen-lockfile
   Copy-Item .env.example .env
   .\scripts\bootstrap.ps1
   ```

3. Для запуска серверной части в разработке:

   ```powershell
   docker compose --env-file .env -f infrastructure\compose.yaml up -d --build
   ```

4. Для запуска desktop-приложения:

   ```powershell
   pnpm dev:desktop
   ```

Локальные `.env`, базы данных, файлы пользователей и собранные `.exe` не
попадают в Git — это уже защищено `.gitignore`.

## Обычный цикл работы

Перед началом задачи всегда обновите `main` и создайте свою ветку:

```powershell
git switch main
git pull --ff-only origin main
git switch -c feature/short-description
```

Примеры: `feature/baxtiyor-voice-search`, `fix/calendar-scroll`.

После законченной части работы:

```powershell
pnpm check
git status
git add <нужные-файлы>
git commit -m "feat: краткое описание"
git push -u origin feature/short-description
```

Затем на GitHub создаётся Pull Request **из своей ветки в `main`**. В PR нужно
описать результат, пройти чек-лист и дождаться зелёных CI-проверок. После
проверки один из вас выполняет Merge Pull Request. Не используйте `force push`
в `main`.

## Как объединять параллельную работу

Если в `main` уже появился чужой PR, перед продолжением своей задачи:

```powershell
git fetch origin
git rebase origin/main
```

Если Git покажет конфликт, исправьте только конфликтующие строки, проверьте
проект и завершите rebase:

```powershell
git add <исправленные-файлы>
git rebase --continue
git push --force-with-lease
```

`--force-with-lease` допустим только для собственной feature/fix-ветки после
rebase; для `main` он запрещён.

## Общая версия для установки

Только код, уже объединённый в `main`, считается общей версией. После merge
нужно на компьютере, где создаётся установщик, выполнить:

```powershell
git switch main
git pull --ff-only origin main
pnpm --filter @yuksalish/desktop dist:win
```

Установщик появится в `apps/desktop/release`. Push в GitHub синхронизирует
исходный код, но не обновляет уже установленные приложения автоматически.

## Настройка GitHub владельцем (один раз)

В GitHub: **Settings → Collaborators** — пригласить Бахтиёра с ролью **Write**.
В **Settings → Branches** создать правило для `main`: требовать Pull Request,
одну проверку перед merge и успешные проверки CI. Это защищает общую версию от
случайного прямого push.
