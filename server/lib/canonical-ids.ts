// Canonical ID helpers for mixed UUID/TEXT legacy tables.
//
// Nexus has older tables where relationship columns are TEXT/VARCHAR and newer
// tables where ids are UUID. Until the database is fully migrated, all cross-table
// joins and parameter comparisons should normalize both sides to text.
//
// Rule:
//   - Use idEq(left, right) for joins.
//   - Use idParam(column, index) for WHERE column = $index.
//   - Never write raw UUID = VARCHAR joins in production SQL.

export function idText(identifier: string) {
  return `${identifier}::text`;
}

export function idEq(left: string, right: string) {
  return `${idText(left)} = ${idText(right)}`;
}

export function idParam(column: string, paramIndex: number) {
  return `${idText(column)} = $${paramIndex}::text`;
}

export function accountParam(alias = "a", paramIndex = 1) {
  return idParam(`${alias}.id`, paramIndex);
}

export function websiteAccountJoin(websiteAlias = "w", accountAlias = "a") {
  return idEq(`${websiteAlias}.account_id`, `${accountAlias}.id`);
}

export function pageWebsiteJoin(pageAlias = "p", websiteAlias = "w") {
  return idEq(`${pageAlias}.website_id`, `${websiteAlias}.id`);
}

export function servicePageJoin(serviceAlias = "s", pageAlias = "p") {
  return idEq(`${pageAlias}.service_id`, `${serviceAlias}.id`);
}

export function jobAccountJoin(jobAlias = "gj", accountAlias = "a") {
  return idEq(`${jobAlias}.account_id`, `${accountAlias}.id`);
}

export function linkWebsiteJoin(linkAlias = "il", websiteAlias = "w") {
  return idEq(`${linkAlias}.website_id`, `${websiteAlias}.id`);
}

export function sitemapWebsiteJoin(sitemapAlias = "sm", websiteAlias = "w") {
  return idEq(`${sitemapAlias}.website_id`, `${websiteAlias}.id`);
}

export function bankWebsiteJoin(bankAlias = "vbc", websiteAlias = "w") {
  return idEq(`${bankAlias}.website_id`, `${websiteAlias}.id`);
}
