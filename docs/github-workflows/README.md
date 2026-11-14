# GitHub Actions 워크플로 (수동 설치 필요)

이 폴더의 두 파일은 **`.github/workflows/` 로 옮겨야** 동작합니다.

> 왜 여기 있나요?
> 저장소를 만든 GitHub 앱(Pickle)에는 `workflows` 권한이 없어서, 워크플로 파일은 저장소 소유자만 추가할 수 있습니다.
> (GitHub 정책: 앱이 스스로 CI 권한을 얻지 못하도록 막는 안전장치)

## 설치 방법 (1분, 택 1)

### A. GitHub 웹에서 파일 2개 만들기
1. https://github.com/topaz1324tmac2002-creator/topaz → **Add file → Create new file**
2. 파일 이름에 `.github/workflows/deploy.yml` 입력
3. 이 폴더의 `deploy.yml` 내용을 붙여넣고 **Commit changes**
4. 같은 방법으로 `.github/workflows/ci.yml` 도 추가

### B. 로컬에서 복사 후 푸시 (git 권한이 있을 때)
```bash
mkdir -p .github/workflows
cp docs/github-workflows/*.yml .github/workflows/
git add .github && git commit -m "ci: GitHub Pages 배포·검사 워크플로 추가" && git push
```

## 각 파일이 하는 일

| 파일 | 역할 |
|---|---|
| `deploy.yml` | main에 푸시될 때마다 타입검사 → 코어 검증 → 빌드 → **GitHub Pages 배포** |
| `ci.yml` | 푸시·PR마다 타입검사 → 코어 검증(`npm run verify`) → 빌드 |

## 배포까지 남은 단계

1. 워크플로 파일 추가 (위 A 또는 B)
2. 저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 변경
3. Actions 탭에서 `Deploy to GitHub Pages` 실행(또는 main에 커밋)
4. 배포 주소: https://topaz1324tmac2002-creator.github.io/topaz/

`vite.config.ts` 의 `base: './'` 덕분에 하위 경로(`/topaz/`)에서도 에셋 경로가 깨지지 않습니다.
