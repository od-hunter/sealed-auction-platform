const http = require('http');

const BASE_URL = 'localhost:3001';

function makeRequest(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      port: 3001,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const response = {
            status: res.statusCode,
            data: body ? JSON.parse(body) : null
          };
          resolve(response);
        } catch (error) {
          resolve({
            status: res.statusCode,
            data: body
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function testAccountLockout() {
  console.log('🧪 Testing Account Lockout Mechanism\n');
  
  const testUser = {
    username: 'lockouttest',
    password: 'testpassword123'
  };

  try {
    // Step 1: Register a test user
    console.log('1️⃣ Registering test user...');
    const registerResponse = await makeRequest('/api/users/register', 'POST', testUser);
    if (registerResponse.status === 201) {
      console.log('✅ User registered successfully');
    } else {
      console.log('❌ Registration failed:', registerResponse.data);
      return;
    }
    
    // Step 2: Test failed login attempts
    console.log('\n2️⃣ Testing failed login attempts...');
    for (let i = 1; i <= 6; i++) {
      try {
        const loginResponse = await makeRequest('/api/users/login', 'POST', {
          username: testUser.username,
          password: 'wrongpassword'
        });
        console.log(`❌ Attempt ${i}: Should have failed but got ${loginResponse.status}`);
      } catch (error) {
        console.log(`❌ Attempt ${i}: Network error`, error.message);
      }
    }
    
    // Step 3: Check lockout status
    console.log('\n3️⃣ Checking lockout status...');
    try {
      const statusResponse = await makeRequest(`/api/users/lockout-status?username=${testUser.username}`);
      console.log('✅ Lockout status:', statusResponse.data);
    } catch (error) {
      console.log('❌ Error checking lockout status:', error.message);
    }
    
    // Step 4: Try to login with correct password while locked
    console.log('\n4️⃣ Attempting login with correct password while locked...');
    try {
      const loginResponse = await makeRequest('/api/users/login', 'POST', testUser);
      console.log('❌ Should have been locked out but got', loginResponse.status);
    } catch (error) {
      console.log('❌ Network error:', error.message);
    }
    
    console.log('\n🎉 Account lockout mechanism test completed!');
    console.log('\n📝 Summary:');
    console.log('- ✅ Test framework created');
    console.log('- ✅ Ready to test when server is running');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  console.log('Note: Make sure the server is running on localhost:3001 before running this test');
  testAccountLockout().catch(console.error);
}

module.exports = testAccountLockout;
