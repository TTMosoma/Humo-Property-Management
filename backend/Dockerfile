# The Humo API image. Build from the repository root (it embeds contracts/role-permissions.json):
#   docker build -f backend/Dockerfile -t humo-api .
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY contracts/ contracts/
# The commercial catalogue Humo starts from (embedded in Humo.Domain; docs/23 §2).
COPY demo-data/commercial/catalogue.json demo-data/commercial/catalogue.json
COPY backend/ backend/
RUN dotnet publish backend/src/Humo.Api -c Release -o /app --no-self-contained

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
# Statement PDFs (D8): headless Chromium prints the app's print route. Fonts for anything the web fonts don't cover.
RUN apt-get update     && apt-get install -y --no-install-recommends chromium fonts-dejavu-core fonts-liberation     && rm -rf /var/lib/apt/lists/*
ENV Documents__ChromiumPath=/usr/bin/chromium
COPY --from=build /app .
# Owned by the app before its volumes are mounted: a new volume takes this ownership, so uploads and logs can be written.
RUN mkdir -p /data/files /data/logs && chown -R app:app /data
# Non-root user shipped with the .NET images.
USER app
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
# Health: GET /api/health (checked by the off-server uptime monitor, doc 26 §5).
ENTRYPOINT ["dotnet", "Humo.Api.dll"]
