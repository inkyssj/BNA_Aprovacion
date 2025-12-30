const { Builder } = require("selenium-webdriver");

app = async() => {
	let driver = await new Builder().forBrowser("chrome").build();

	try {
		await require('./functions/app.js')(driver);
	} finally {
		await driver.quit();
	}
}

app();