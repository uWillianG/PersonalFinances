import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const fixtureCsv = fileURLToPath(
  new URL("../../fixtures/sample.csv", import.meta.url),
);

/** A real one-page PDF with byte-accurate xref offsets, containing synthetic data only. */
function syntheticPdf(): Buffer {
  const stream = [
    "BT /F1 14 Tf 50 735 Td",
    "(Extrato sintetico para teste) Tj",
    "0 -35 Td (03/11/2026 Padaria Sintetica -12,34) Tj",
    "0 -35 Td (04/11/2026 Farmacia Sintetica -56,78) Tj ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
  ];
  let content = "%PDF-1.4\n%Synthetic fixture\n";
  const offsets: number[] = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(content, "ascii"));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(content, "ascii");
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  content += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(content, "ascii");
}

async function demoImports(page: Page): Promise<string[]> {
  const apiWrites: string[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname.startsWith("/api/") &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())
    )
      apiWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  // Every test gets an anonymous browser context. Demo changes stay in React state.
  await page.goto("/");
  await expect(
    page.getByText("Modo demonstração", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Navegação principal", exact: true })
    .getByRole("button", { name: "Importações", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Seu mês começa aqui.", exact: true }),
  ).toBeVisible();
  return apiWrites;
}

async function selectDemoBank(page: Page, fileName: string): Promise<void> {
  const account = page.getByLabel(`Conta de ${fileName}`, { exact: true });
  await expect(
    account.getByRole("option", { name: "Minha conta · Nubank", exact: true }),
  ).toHaveCount(1);
  await account.selectOption("demo-nubank");
  await page.getByLabel(`Mês de ${fileName}`, { exact: true }).fill("2026-11");
}

test.describe("Importadores reais no navegador em modo demonstração", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("uma categoria ensinada é reaproveitada na próxima importação", async ({
    page,
  }) => {
    await page.goto("/");
    const navigation = page.getByRole("navigation", {
      name: "Navegação principal",
      exact: true,
    });
    await navigation
      .getByRole("button", { name: "Lançamentos", exact: true })
      .click();
    await page
      .locator(".tx-description")
      .filter({ hasText: "Compra a identificar" })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Categoria", { exact: true })
      .fill("Compras da casa");
    await page
      .getByLabel(
        "Usar esta categoria nas próximas compras deste estabelecimento",
        { exact: false },
      )
      .check();
    await page
      .getByRole("button", { name: "Salvar lançamento", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await navigation
      .getByRole("button", { name: "Contas e saldos", exact: true })
      .click();
    await expect(page.locator(".rules-panel")).toContainText("Compras da casa");
    await navigation
      .getByRole("button", { name: "Importações", exact: true })
      .click();
    await page
      .getByLabel("Selecionar arquivos de extrato", { exact: true })
      .setInputFiles({
        name: "nova-compra.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          "data;descricao;valor\n2026-11-24;Compra a identificar;-42,00\n",
        ),
      });
    await selectDemoBank(page, "nova-compra.csv");
    await page
      .getByRole("button", { name: "Ler arquivos", exact: true })
      .click();
    await expect(page.locator(".preview-table tbody tr")).toHaveCount(1);
    await expect(page.locator(".preview-table tbody tr")).toContainText(
      "Compras da casa",
    );
    await expect(page.locator(".preview-table tbody tr")).not.toContainText(
      "Revisar",
    );
  });

  test("CSV passa pela seleção, prévia e confirmação sem escrever no banco", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const apiWrites = await demoImports(page);
    await page
      .getByLabel("Selecionar arquivos de extrato", { exact: true })
      .setInputFiles(fixtureCsv);
    await selectDemoBank(page, "sample.csv");
    await page
      .getByRole("button", { name: "Ler arquivos", exact: true })
      .click();

    const rows = page.locator(".preview-table tbody tr");
    await expect(rows).toHaveCount(5);
    await expect(rows.filter({ hasText: "Pix Mercado Exemplo" })).toContainText(
      "125,90",
    );
    await expect(
      rows.filter({ hasText: "Salário Empresa Exemplo" }),
    ).toContainText("4.200,00");
    await expect(
      page
        .getByText("novos lançamentos selecionados", { exact: true })
        .locator(".."),
    ).toContainText("5");
    await page
      .getByRole("button", { name: "Confirmar importação", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Seu mês ganhou clareza.",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".import-success")).toContainText(
      "5 lançamentos",
    );
    expect(apiWrites).toEqual([]);
  });

  test("PDF sintético usa PDF.js e mantém datas e valores na prévia", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const apiWrites = await demoImports(page);
    await page
      .getByLabel("Selecionar arquivos de extrato", { exact: true })
      .setInputFiles({
        name: "extrato-sintetico.pdf",
        mimeType: "application/pdf",
        buffer: syntheticPdf(),
      });
    await selectDemoBank(page, "extrato-sintetico.pdf");
    const pdfWorker = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/pdf.worker.min.mjs",
      { timeout: 30_000 },
    );
    await page
      .getByRole("button", { name: "Ler arquivos", exact: true })
      .click();
    expect((await pdfWorker).ok()).toBeTruthy();

    const rows = page.locator(".preview-table tbody tr");
    await expect(rows).toHaveCount(2, { timeout: 30_000 });
    const bakery = rows.filter({ hasText: "Padaria Sintetica" });
    await expect(bakery.getByRole("cell").nth(1)).toHaveText(
      /03\s+(?:de\s+)?nov/i,
    );
    await expect(bakery).toContainText("12,34");
    const pharmacy = rows.filter({ hasText: "Farmacia Sintetica" });
    await expect(pharmacy.getByRole("cell").nth(1)).toHaveText(
      /04\s+(?:de\s+)?nov/i,
    );
    await expect(pharmacy).toContainText("56,78");
    await expect(
      page.getByRole("button", { name: "Confirmar importação", exact: true }),
    ).toBeEnabled();
    expect(apiWrites).toEqual([]);
  });

  test("PNG sintético é reconhecido pelo Tesseract real sem upload do documento", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const apiWrites = await demoImports(page);
    // This canvas is a test fixture, containing no user data or app screenshots.
    const imageData = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 400;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas indisponível");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "black";
      context.font = "36px Arial";
      context.textBaseline = "top";
      context.fillText("Extrato sintetico", 60, 40);
      context.fillText("03/11/2026 Padaria Sintetica -12,34", 60, 130);
      context.fillText("04/11/2026 Farmacia Sintetica -56,78", 60, 220);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    const remoteDocumentUploads: string[] = [];
    const applicationOrigin = new URL(page.url()).origin;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        ["http:", "https:"].includes(url.protocol) &&
        url.origin !== applicationOrigin &&
        ["POST", "PUT", "PATCH"].includes(request.method())
      )
        remoteDocumentUploads.push(request.url());
    });
    await page
      .getByLabel("Selecionar arquivos de extrato", { exact: true })
      .setInputFiles({
        name: "imagem-sintetica.png",
        mimeType: "image/png",
        buffer: Buffer.from(imageData, "base64"),
      });
    await selectDemoBank(page, "imagem-sintetica.png");
    await page
      .getByRole("button", { name: "Ler arquivos", exact: true })
      .click();

    const rows = page.locator(".preview-table tbody tr");
    await expect
      .poll(() => rows.count(), {
        timeout: 160_000,
        message:
          "O OCR real deve reconhecer pelo menos as duas linhas datadas da imagem sintética.",
      })
      .toBeGreaterThanOrEqual(2);
    await expect(rows.filter({ hasText: /Padaria/i })).toContainText("12,34");
    await expect(rows.filter({ hasText: /Farmacia|Farmácia/i })).toContainText(
      "56,78",
    );
    await expect(
      page.getByRole("button", { name: "Confirmar importação", exact: true }),
    ).toBeEnabled();
    expect(apiWrites).toEqual([]);
    expect(remoteDocumentUploads).toEqual([]);
  });
});
