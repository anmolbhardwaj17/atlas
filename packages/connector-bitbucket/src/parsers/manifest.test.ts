import { describe, it, expect } from "vitest";
import { parseManifest } from "./manifest";

describe("parseManifest", () => {
  it("npm package.json — deps + devDeps", () => {
    const deps = parseManifest(
      "package.json",
      JSON.stringify({
        dependencies: { lodash: "4.17.11" },
        devDependencies: { vitest: "^1.0.0" },
      }),
    );
    expect(deps).toEqual([
      { ecosystem: "npm", name: "lodash", version: "4.17.11" },
      { ecosystem: "npm", name: "vitest", version: "^1.0.0" },
    ]);
  });

  it("pypi requirements.txt — skips flags/comments", () => {
    const deps = parseManifest("requirements.txt", "# comment\ndjango==4.2.1\n-r other.txt\nflask");
    expect(deps).toEqual([
      { ecosystem: "pypi", name: "django", version: "4.2.1" },
      { ecosystem: "pypi", name: "flask", version: null },
    ]);
  });

  it("go.mod — require block", () => {
    const deps = parseManifest("go.mod", "module x\nrequire (\n  github.com/pkg/errors v0.9.1\n)");
    expect(deps).toEqual([{ ecosystem: "go", name: "github.com/pkg/errors", version: "v0.9.1" }]);
  });

  it("maven pom.xml — groupId:artifactId", () => {
    const deps = parseManifest(
      "pom.xml",
      `<project><dependencies>
        <dependency><groupId>org.apache.commons</groupId><artifactId>commons-lang3</artifactId><version>3.12.0</version></dependency>
      </dependencies></project>`,
    );
    expect(deps).toEqual([
      { ecosystem: "maven", name: "org.apache.commons:commons-lang3", version: "3.12.0" },
    ]);
  });

  it("unknown file → []", () => {
    expect(parseManifest("README.md", "hi")).toEqual([]);
  });
});
