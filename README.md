# 말랑 마작 🐾

귀여운 동물 타일 짝맞추기 퍼즐 게임 · 레벨 1~500 · 제한 시간 · 랭킹

- 플레이: https://mallang-mahjong.neon-hyperdrive-worker.workers.dev
- 5의 배수 레벨은 🔥 어려움, 10의 배수 레벨은 💀 매우 어려움 (20레벨부터 안개)

## 구조
| 파일 | 역할 |
|---|---|
| `public/index.html` | 게임 화면 (홈 / 레벨 지도 / 게임 / 랭킹) |
| `public/levels.js` | 레벨 규칙·배치·점수 (브라우저와 Worker가 공유) |
| `src/worker.js` | API (`/api/register`, `/api/me`, `/api/rename`, `/api/clear`, `/api/ranking`) |
| `migrations/0001_init.sql` | D1 테이블 (`players`, `level_scores`) |
| `wrangler.jsonc` | Cloudflare Worker + D1 설정 |

## 로컬 실행
```bash
wrangler d1 migrations apply mallang-mahjong-db --local
wrangler dev
```

## 배포
```bash
wrangler d1 migrations apply mallang-mahjong-db --remote
wrangler deploy
```
