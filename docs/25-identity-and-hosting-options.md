# 25 — Identity provider and hosting: options and recommendation

Status: **for decision** (D5 and hosting), 18 October 2026. Prepared for Terry Mosoma.

**What's being decided:**
- **D5:** who signs people in to Humo Property Management, with passkeys first.
- **Hosting:** where the .NET API and its database run.

Backend slice 1 can't start until both are chosen (doc 24, audit roadmap §4).

**Caveat:** prices and regional availability change. Figures marked ⚠ come from secondary sources or couldn't be confirmed against the vendor's own page. Check them on the vendor pricing page or calculator before committing.

---

## 1. What Humo needs

| Need | Why |
|---|---|
| **Passkeys first,** plus email sign-in links or codes | The sign-in page is built for this already (R-8). Customers and Humo staff never use passwords. |
| **Our own branded sign-in page** | `/sign-in` is Humo's front door. The provider either styles its hosted page to match, or exposes an API/SDK behind ours. |
| **Scale at a sensible cost** | People who sign in: agency staff, trustees, owners and tenants. The target book is about 8 000 active users a month, and owners and residents could grow to tens of thousands. Pricing per monthly active user (MAU) matters. |
| **.NET integration** | Standard OpenID Connect and JWT validation in ASP.NET Core. |
| **POPIA** | Customer data hosted in South Africa avoids the cross-border transfer question (s72). Hosting abroad needs a s72 ground (usually a binding agreement) and an operator contract (s21). |
| **Little to run** | Humo is a small team: managed services over servers to patch. |
| **Step-up** | A fresh passkey proof for sensitive actions (doc 03; `STEP_UP_FRESH_MS` = 5 minutes). |

## 2. Identity provider (D5)

| | **Microsoft Entra External ID** | **Amazon Cognito (Essentials)** | **Auth0 (Okta)** | **Keycloak** (self-hosted, open source) |
|---|---|---|---|---|
| Passkeys | Yes, for customers; passkey can be the only method | Yes, in Essentials (passkeys, email or SMS) | Yes ⚠ (which plan includes it unconfirmed) | Yes (WebAuthn) |
| Free tier | **50 000 MAU** | **10 000 MAU** ⚠ | Free plan ⚠ (sources say 7 500 or 25 000 users) | No licence cost |
| Beyond the free tier | A small price per MAU ⚠ (check the official rate). Premium add-ons may have no free tier. | About US$0.015 per MAU ⚠ | Paid plans from about US$35/month for 500 MAU ⚠. Rises steeply with MAU and MFA. | Hosting and the people to run it |
| Where identity data lives | Chosen at tenant creation, permanently. Groupings include **EMEA**, not South Africa by name. | **Cape Town (af-south-1)**: in-country | Region chosen per tenant ⚠ | Wherever you host it (South Africa possible) |
| .NET fit | First-class (Microsoft.Identity.Web) | Standard OIDC | Standard OIDC | Standard OIDC |
| Branding | Customisable hosted pages ⚠ (how far needs checking) | Managed login, customisable | Strong (Universal Login) | Full control (themes) |
| Running it | Managed | Managed | Managed | **You run it:** upgrades, backups, high availability, security patches |
| Lock-in | Medium | Medium | Medium | Low |

**How they compare:**
- **Entra External ID** is the best fit if Humo hosts on Azure. It's .NET-native, has passkeys, and its free tier (50 000 MAU) covers the whole projected user base. **Open point:** identity data would sit in the "EMEA" location, not in South Africa, so it needs a POPIA s72 agreement (Microsoft's data protection terms).
- **Cognito** is the in-country option, holding identity data in Cape Town. It's the natural choice if Humo hosts on AWS, or if keeping all personal data in South Africa is a firm requirement.
- **Auth0** is the most polished developer experience, but the most expensive as owners and residents grow. Hard to justify at Humo's per-unit economics.
- **Keycloak** has no licence cost and full control, but Humo would be running a security-critical system itself. Not recommended for a small team at launch.

## 3. Hosting and database

| | **Azure, South Africa North (Johannesburg)** | **AWS, Africa (Cape Town, af-south-1)** | **Local South African host** (VPS / managed) |
|---|---|---|---|
| In South Africa | Yes; three availability zones | Yes | Yes |
| PostgreSQL | **Azure Database for PostgreSQL Flexible Server**, available in the region | Amazon RDS for PostgreSQL ⚠ (expected; confirm in the console) | Self-managed, or the host's managed offer |
| Running the .NET API | App Service, or AKS (available in the region). Container Apps ⚠ (availability unconfirmed: check before choosing it). | ECS / Fargate ⚠ (confirm in the region) | VMs or containers you manage |
| Identity pairing | Entra External ID | Cognito, in-region | Any |
| Effort for a small team | Low (managed services, .NET-friendly) | Low to medium | Higher (patching, backups, monitoring) |
| Cost | Pay as you go. Rand billing through a South African partner is possible ⚠. | Pay as you go (USD) ⚠ | Often cheapest in rands, but you carry the running cost |

**Database:** **PostgreSQL** rather than SQL Server.
- No licence cost.
- Excellent with EF Core.
- Available as a managed service on both clouds.
- The prototype's data model has nothing SQL Server-specific.

## 4. Recommendation

**Azure South Africa North + Entra External ID + Azure Database for PostgreSQL (Flexible Server) + App Service for the API.**

**Why:**
1. **Business data stays in South Africa:** the API, database and files are in Johannesburg, so POPIA is simplest for the data that matters most.
2. **Shortest path to a working slice 1:** Entra External ID is .NET-native, has passkeys, and is free up to 50 000 MAU, which covers the projected user base.
3. **All managed:** nothing to patch at launch.
4. **One vendor relationship and one bill.**

**Conditions and open points:**
- **Identity data in EMEA.** Sign-in credentials and profile data would sit in Microsoft's EMEA location, not South Africa. Record it as a POPIA s72 transfer covered by Microsoft's data protection terms, and confirm with a privacy lawyer.
  - **If that isn't acceptable:** choose **AWS Cape Town + Cognito** instead. Everything stays in South Africa. The cost is a less .NET-native setup and a smaller free tier (10 000 MAU ⚠).
- **Check before signing up:** Container Apps in South Africa North (otherwise use App Service), and the current External ID MAU rate.
- **Branding:** prototype the hosted sign-in page with Humo's design before committing; the `/sign-in` page in this repo is the target.

## 5. What happens once you decide

1. **Create the accounts:**
   - an Azure subscription (South Africa North);
   - an External ID tenant (EMEA);
   - a PostgreSQL Flexible Server (development and production).
2. **Set up the .NET solution:**
   - API project, EF Core migrations and OIDC/JWT validation;
   - `GET /me` built from the token and the database;
   - CI deploying to a development environment.
3. **Swap the frontend's session to the real sign-in.**
   - `HttpSessionDataSource` already calls `/me`.
   - Sign-in then redirects to External ID instead of answering "unavailable".
4. **Build the rest of slice 1 against doc 24, port by port.** Each port moves out of the "not connected" list in `provide-http-data.ts` as its endpoint lands.
5. **POPIA paperwork alongside:**
   - operator agreement;
   - s72 record for identity data;
   - privacy policy;
   - terms.

## Sources

- [Microsoft Entra External ID pricing (Azure China, MAU tiers)](https://www.azure.cn/en-us/pricing/details/microsoft-entra-external-id)
- [Azure AD B2C / External ID pricing](https://azure.microsoft.com/en-ca/pricing/details/active-directory-b2c/)
- [Entra External ID: sign in with a passkey (customers)](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-sign-in-with-passkey)
- [Entra data residency](https://learn.microsoft.com/en-us/entra/fundamentals/data-residency)
- [Amazon Cognito in Africa (Cape Town)](https://aws.amazon.com/about-aws/whats-new/2023/12/amazon-cognito-africa-cape-town-region)
- [Amazon Cognito pricing](https://aws.amazon.com/cognito/pricing/)
- [Cognito Essentials MAU (Vantage)](https://cur.vantage.sh/aws/amazoncognito/amazon-cognito---essentials/cognitoessentialsmau/)
- [Cognito passkeys and tiers (Dark Reading)](https://darkreading.com/identity-access-management-security/aws-rolls-out-updates-to-amazon-cognito)
- [Auth0 pricing](https://Auth0.com/pricing)
- [Auth0 pricing changes](https://auth0.com/blog/upcoming-pricing-changes-for-the-customer-identity-cloud/)
- [Azure South Africa North availability zones](https://azure.microsoft.com/pt-br/updates/south-africa-north-availability-zones-now-generally-available/)
- [AKS in South Africa North](https://azure.microsoft.com/en-us/updates/general-availability-azure-kubernetes-service-in-south-africa-north/)
- [Azure Database for PostgreSQL in South Africa](https://mc.merill.net/message/AZ-azure-database-for-postgresql-now-available-in-south-africa-regions)
- [South Africa North region profile](https://www.azurespeed.com/Information/AzureRegions/SouthAfricaNorth)
- [POPIA cross-border transfers (CMS)](https://cms.law/en/zaf/legal-updates/Managing-cross-border-data-transfers)
- [POPIA section 72 and the cloud (PER/PELJ)](https://www.saflii.org/za/journals/PER/2024/39.html)
