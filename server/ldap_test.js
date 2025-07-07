const ldap = require('ldapjs');

const client = ldap.createClient({
  url: 'ldap://ldap.forumsys.com'
});

const username = 'tesla';
const password = 'password';
const userDN = `uid=${username},dc=example,dc=com`;  // MUST use this DN to bind

client.bind(userDN, password, (err) => {
  if (err) {
    console.error('❌ Authentication failed:', err.message);
    return;
  }

  console.log('✅ Authentication successful');

  // Search for user's OU
  const searchOptions = {
    scope: 'sub',
    filter: `(uid=${username})`,
    attributes: ['dn', 'ou']
  };

  client.search('dc=example,dc=com', searchOptions, (err, res) => {
    if (err) {
      console.error('❌ Search error:', err.message);
      return;
    }

    res.on('searchEntry', (entry) => {
    const dn = entry.dn.toString(); // e.g. "uid=tesla,dc=example,dc=com"
    const ouMatch = dn.match(/ou=([^,]+)/);
    const ou = ouMatch ? ouMatch[1] : '(no OU)';
    console.log(`🔍 User "${username}" DN: ${dn}`);
    console.log(`📁 OU extracted from DN: ${ou}`);
    });

    res.on('end', () => {
      client.unbind();
    });
  });
});
