const AutoUserManager = require("./utils/autoUserManager");

async function testSetupDetection() {
	try {
		console.log("Testing server setup detection...");
		
		// Test with a non-existent server (should trigger needsSetup)
		const result = await AutoUserManager.validateUserForCommand("123456789", "999999999", null);
		console.log("Test result:", result);
		
		if (result.needsSetup) {
			console.log("✅ Correctly detected that server needs setup!");
		} else {
			console.log("❌ Failed to detect server setup need");
		}
		
		console.log("Setup detection test completed!");
	}
	catch (error) {
		console.error("Setup detection test failed:", error);
	}
}

testSetupDetection();