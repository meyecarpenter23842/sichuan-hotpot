import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const web = "http://127.0.0.1:3000";
const require=createRequire(import.meta.url);
const { PrismaClient }=require("@prisma/client");
const db=new PrismaClient();
const seedBranch=await db.branch.findFirst({
  where:{name:{startsWith:"P22 QA "}},orderBy:{createdAt:"desc"},
  select:{id:true},
});
assert.ok(seedBranch,"P22 disposable branch required for Home QA");
const offerId=randomUUID();
const heroIds=[randomUUID(),randomUUID()];
const heroKeys=heroIds.map(id=>"catalog-media/"+seedBranch.id+"/hero/"+id+"/"+randomUUID()+".webp");
const popupIds=[randomUUID(),randomUUID()];
const popupKeys=popupIds.map(id=>"catalog-media/"+seedBranch.id+"/popup/"+id+"/"+randomUUID()+".webp");
await db.homeOffer.create({data:{
  id:offerId,branchId:seedBranch.id,title:"Ưu đãi QA cuối tuần",
  summary:"Tặng lời chúc cuối tuần",body:"L04 kiểm tra popup nội dung thật từ API.",
  imageKey:"catalog-media/"+seedBranch.id+"/offers/"+offerId+"/"+randomUUID()+".webp",
  enabled:true,sortOrder:0,ctaTarget:"MENU",
  startAt:new Date(Date.now()-3600000),endAt:new Date(Date.now()+3600000),
}});
await db.homeHeroConfig.upsert({
  where:{branchId:seedBranch.id},
  create:{branchId:seedBranch.id,autoplay:true,dwellMs:2000,transitionType:"fade",
    transitionDurationMs:250,revision:21},
  update:{autoplay:true,dwellMs:2000,transitionType:"fade",
    transitionDurationMs:250,revision:{increment:21}},
});
await db.homeHeroSlide.createMany({data:heroIds.map((id,index)=>({
  id,branchId:seedBranch.id,imageKey:heroKeys[index],altText:"Hero QA "+(index+1),
  title:null,subtitle:null,ctaTarget:null,enabled:true,sortOrder:index,
}))});
await db.homePopupConfig.upsert({
  where:{branchId:seedBranch.id},
  create:{branchId:seedBranch.id,enabled:true,repeatIntervalMinutes:30,slideDwellMs:2000,revision:11},
  update:{enabled:true,repeatIntervalMinutes:30,slideDwellMs:2000,revision:{increment:11}},
});
await db.homePopupSlide.createMany({data:popupIds.map((id,index)=>({
  id,branchId:seedBranch.id,imageKey:popupKeys[index],altText:"Popup QA "+(index+1),
  enabled:true,sortOrder:index,
}))});
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const directory = "apps/customer/qa-artifacts";
mkdirSync(directory, { recursive: true });

try {
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [428, 926], [768, 1024]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const tinyPng=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR42mNkYGD4z8DAwMDAAAAEAQEABn0C/QAAAABJRU5ErkJggg==","base64");
    await page.route("https://pub-63ed7b1c33514906ab6e2d82f41bffce.r2.dev/catalog-media/"+seedBranch.id+"/popup/**",
      route=>route.fulfill({status:200,contentType:"image/png",body:tinyPng}));
    await page.route("https://pub-63ed7b1c33514906ab6e2d82f41bffce.r2.dev/catalog-media/"+seedBranch.id+"/hero/**",
      route=>route.fulfill({status:200,contentType:"image/png",body:tinyPng}));
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(web, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Xem thực đơn mà không cần đăng nhập/ }).click();
    const earlyPopup=page.getByTestId("home-promo-popup");
    if(await earlyPopup.isVisible().catch(()=>false))
      await page.getByRole("button",{name:"Đóng popup",exact:true}).click();
    // P22 seeded this exact product into disposable CI PostgreSQL. Select its
    // branch so homepage screenshots exercise the real carousel, not only empty state.
    await page.getByRole("tab", { name: "Thực đơn" }).click();
    await db.homePopupConfig.update({where:{branchId:seedBranch.id},data:{revision:{increment:1}}});
    await page.getByRole("button", { name: /^P22 QA / }).first().click();
    await page.getByRole("button", { name: "Xem món Lẩu QA vị Tứ Xuyên" }).waitFor();
    await page.getByRole("tab", { name: "Trang chủ" }).click();
    await page.getByRole("tab", { name: "Trang chủ" }).waitFor();
    await page.getByTestId("home-feature-carousel").waitFor();
    const promoPopup=page.getByTestId("home-promo-popup");
    await promoPopup.waitFor();
    const promoCard=page.getByTestId("home-promo-card");
    const promoRect=await promoCard.boundingBox();
    assert.ok(promoRect&&promoRect.x>=0&&promoRect.y>=0&&
      promoRect.x+promoRect.width<=width+1&&promoRect.y+promoRect.height<=height+1,
      "Home popup clipped at "+width+"x"+height);
    if(width===320){
      await page.screenshot({path:directory+"/p24-home-popup-"+width+"x"+height+".png"});
      await page.getByTestId("home-promo-slide-0").waitFor();
      await page.getByTestId("home-promo-slide-1").waitFor({timeout:3500});
      assert.equal(await page.getByTestId("home-promo-slide-1").count(),1,
        "Home popup must auto-slide horizontally using configured dwell time");
    }
    await page.getByRole("button",{name:"Đóng popup",exact:true}).click();
    await promoPopup.waitFor({state:"hidden",timeout:3000});
    const liveHero=page.getByTestId("home-live-hero");
    await liveHero.waitFor();
    const heroRegion=page.getByTestId("home-approved-hero");
    const [heroRect,regionRect]=await Promise.all([liveHero.boundingBox(),heroRegion.boundingBox()]);
    assert.ok(heroRect&&regionRect&&Math.abs((heroRect.y+heroRect.height)-(regionRect.y+regionRect.height))<=2,
      "Hero region must not reserve a blank strip below the banner");
    if(width===320){
      await page.waitForFunction(()=>document.querySelector('[data-testid="home-live-hero"]')
        ?.getAttribute("aria-label")?.includes("Banner 2 trên 2"),null,{timeout:3500});
      await page.waitForFunction(()=>document.querySelector('[data-testid="home-live-hero"]')
        ?.getAttribute("aria-label")?.includes("Banner 1 trên 2"),null,{timeout:3500});
    }
    const promotion=page.getByRole("button",{name:"Xem ưu đãi Ưu đãi QA cuối tuần"});
    await promotion.waitFor();
    await promotion.click();
    await page.getByText("L04 kiểm tra popup nội dung thật từ API.").waitFor();
    assert.equal(await page.getByText("Tặng lời chúc cuối tuần").count(),1,
      "Offer summary must stay in details popup, not cover Home photography");
    await page.getByRole("button",{name:"Đóng popup ưu đãi"}).click();
    assert.equal(await page.getByText("L04 kiểm tra popup nội dung thật từ API.").count(),0,
      "Popup must close without changing Home or dropping scroll position");
    const homeHeroImage = page.getByTestId("home-approved-hero").locator("img").first();
    await homeHeroImage.waitFor();
    assert.equal(await homeHeroImage.evaluate(img => img.complete && img.naturalWidth > 0), true,
      "Approved Home hero artwork failed to render at " + width);
    assert.equal(await page.getByRole("textbox", { name: "Tìm món ăn, trà sữa" }).count(), 0,
      "Owner removed home search; it must remain only in menu");
    for (const [label, icon] of [
      ["Lẩu", "hotpot"], ["Trà sữa", "milkTea"], ["Combo", "combo"],
      ["Topping", "topping"], ["Ưu đãi", "offers"],
    ]) {
      const button = page.getByRole("button", { name: "Xem danh mục " + label, exact: true });
      await button.waitFor();
      const rect = await button.boundingBox();
      assert.ok(rect && rect.x >= -1 && rect.x + rect.width <= width + 1,
        "Category clipped: " + label + " at " + width);
      const image = page.getByTestId("home-category-icon-" + icon).first().locator("img");
      await image.waitFor();
      assert.equal(await image.evaluate(img => img.complete && img.naturalWidth > 0), true,
        "Category artwork failed to load: " + label);
    }
    const nav = page.getByRole("tab", { name: "Trang chủ" });
    const before = await nav.boundingBox();
    assert.ok(before && Math.abs(before.y + before.height - height) <= 5,
      "Bottom nav not fixed at viewport bottom: " + width + "x" + height);
    await page.mouse.wheel(0, 900);
    const after = await nav.boundingBox();
    assert.ok(after && Math.abs(before.y - after.y) <= 1, "Bottom nav moves during scroll");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true, "horizontal overflow at " + width);
    assert.deepEqual(errors, [], "browser errors at " + width);
    await page.screenshot({ path: directory + "/p24-home-" + width + "x" + height + ".png" });
    await page.getByRole("button", { name: "Chọn tùy chọn Lẩu QA vị Tứ Xuyên" }).click();
    await page.getByText("Khẩu phần / size").waitFor();
    await page.getByRole("tab", { name: "Trang chủ" }).click();
    await page.getByRole("button", { name: "Xem danh mục Trà sữa" }).click();
    await page.getByRole("tab", { name: "Thực đơn" }).waitFor();
    await page.getByRole("textbox", { name: "Tìm món ăn, trà sữa" }).waitFor();
    await ctx.close();
    console.log("PASS: Home reference categories, fixed tabs, menu search and artwork", width, height);
  }
} finally {
  await db.homePopupSlide.deleteMany({where:{id:{in:popupIds}}});
  await db.homePopupConfig.deleteMany({where:{branchId:seedBranch.id}});
  await db.homeHeroSlide.deleteMany({where:{id:{in:heroIds}}});
  await db.homeHeroConfig.deleteMany({where:{branchId:seedBranch.id}});
  await db.homeOffer.deleteMany({where:{id:offerId}});
  await db.$disconnect();
  await browser.close();
}
