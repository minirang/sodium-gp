# SODIUM GP

가로등이 켜지는 시간, 도시가 서킷이 되는 3D 웹 레이싱 게임. (Three.js + cannon-es, WebGL)

## 실행

- `index.html`을 더블클릭하면 바로 실행됩니다. (번들된 `dist/game.js` 사용)
- 소스를 고쳤다면: `npm install` → `npm run build`

## 조작

| 동작                    | 키보드                      | 모바일             |
| ----------------------- | --------------------------- | ------------------ |
| 가속 / 브레이크·후진    | ↑ W / ↓ S                   | 가속·브레이크 버튼 |
| 조향                    | ← → / A D, 화면 핸들 드래그 | 화면 핸들 드래그   |
| 핸드브레이크            | Space                       | 핸드 버튼          |
| 시점 전환 (1인칭/3인칭) | C                           | 시점 버튼          |
| 수동 기어               | E / Q (설정에서 수동 선택)  | 기어 +/− 버튼      |
| 위치 복귀 / 일시정지    | R / Esc                     | 복귀 / Ⅱ 버튼      |

## 폴더 구조

```
index.html        진입 페이지 (메인 화면·HUD·모달 마크업)
css/              스타일
src/
  main.js         시작점
  game.js         레이스 진행, 카메라, 조명, 렌더 루프
  config.js       차량·코스·AI·품질·설정 항목 정의
  store.js        설정/커스텀 저장 (localStorage)
  world/city.js   코스 생성 (도로·연석·인도·강·건물·가로등·배리어·충돌체)
  vehicle/        차량 모델, 물리(RaycastVehicle, 기어박스), AI
  systems/        입력(키보드·마우스·멀티터치), 사운드(WebAudio)
  ui/             메인 화면·설정·가이드, HUD·미니맵
dist/game.js      빌드 결과물
```
