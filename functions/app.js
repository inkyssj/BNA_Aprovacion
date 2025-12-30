const { By } = require('selenium-webdriver');

const config = require('../config.js');
const { waitForMailCode } = require('./mailReader.js');

const sleep = (ms) => {
	return new Promise(resolve => setTimeout(resolve, ms * 1000));
}

const clearCUIL = (CUIL) => {
	return {
		'prefixCUIL': CUIL.slice(0, 2),
		'descripCUIL': CUIL.slice(2, -1),
		'suffixCUIL': CUIL.slice(-1)
	}
}

const app = async(driver) => {
	await driver.get(config.websiteBNA);

	let clickBtn = async(id) => {
		let btnClick = await driver.findElement(By.id(id));
		return await btnClick.click();
	}

	await clickBtn('btnSacalaAhora')
	.then(async(c) => {
		let searchIdImputs = async(id, teks) => {
			let inputCUIL = await driver.findElement(By.id(id));
			await inputCUIL.sendKeys(teks);
		}
		let CUIL = clearCUIL(config.user.CUIL);
		await searchIdImputs('prefixCUIL', CUIL.prefixCUIL);
		await searchIdImputs('descripCUIL', CUIL.descripCUIL);
		await searchIdImputs('suffixCUIL', CUIL.suffixCUIL);
		await searchIdImputs('CorreoElectronico', config.user.mail);
		await searchIdImputs('CorreoElectronicoCompare', config.user.mail);

		await clickBtn('btnEnviarCorreo')
		.then(async(c) => {
			let code = await waitForMailCode({
				userEmail: config.user.mail,
				appPassword: config.user.mailAppPassword,
				fromEmail: config.bnaMailCode
			});
			await searchIdImputs('CodigoCorreo1', code);
			await clickBtn('btnValidarCorreo');
			await sleep(3);
			await clickBtn('AceptaTyC');
			await clickBtn('AceptaTyConBoarding');
			await clickBtn('btnAceptaTyC');
			await sleep(3600);
		})
		.catch(e => console.log(String(e)))
	})
	.catch(e => console.log(String(e)))
}

module.exports = app