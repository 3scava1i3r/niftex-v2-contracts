const { BN, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');

contract('Workflow', function (accounts) {
	const [ admin, user1, user2, user3, other1, other2, other3 ] = accounts;

	const ShardedWallet        = artifacts.require('ShardedWallet');
	const ShardedWalletFactory = artifacts.require('ShardedWalletFactory');
	const Governance           = artifacts.require('BasicGovernance');
	const Modules = {
		Action:    { artifact: artifacts.require('ActionModule')         },
		Buyout:    { artifact: artifacts.require('BuyoutModule')         },
		Crowdsale: { artifact: artifacts.require('CrowdsaleBasicModule') },
	};
	const Mocks = {
		ERC721:    { artifact: artifacts.require('ERC721Mock'),  args: [ 'ERC721Mock', '721']                                    },
		// ERC777:    { artifact: artifacts.require('ERC777Mock'),  args: [ admin, web3.utils.toWei('1'), 'ERC777Mock', '777', [] ] }, // needs erc1820registry
		ERC1155:   { artifact: artifacts.require('ERC1155Mock'), args: [ '' ]                                                    },
	};

	let instance;

	before(async function () {
		// Deploy factory
		this.factory = await ShardedWalletFactory.new();
		// Deploy governance (2 weeks, 1%, 2 weeks, 1%)
		this.governance = await Governance.new(50400, web3.utils.toWei('0.01'), 50400, web3.utils.toWei('0.01'));
		// Deploy & whitelist modules
		this.modules = await Object.entries(Modules).reduce(async (acc, [ key, { artifact, args } ]) => ({ ...await acc, [key.toLowerCase()]: await artifact.new(...(args || [])) }), Promise.resolve({}));
		for ({ address } of Object.values(this.modules))
		{
			await this.governance.grantRole(await this.governance.MODULE_ROLE(), address);
		}
		// Deploy Mocks
		this.mocks = await Object.entries(Mocks).reduce(async (acc, [ key, { artifact, args } ]) => ({ ...await acc, [key.toLowerCase()]: await artifact.new(...(args || [])) }), Promise.resolve({}));
		// Verbose
		const { gasUsed } = await web3.eth.getTransactionReceipt(this.factory.transactionHash);
		console.log('factory deployment:', gasUsed);
	});

	describe('Initialize', function () {
		it('perform', async function () {
			const { receipt } = await this.factory.mintWallet(
				this.governance.address,      // governance_
				user1,                        // owner_
				'Tokenized NFT',              // name_
				'TNFT',                       // symbol_
			);
			instance = await ShardedWallet.at(receipt.logs.find(({ event}) => event == "NewInstance").args.instance);
			console.log('tx.receipt.gasUsed:', receipt.gasUsed);
		});

		after(async function () {
			assert.equal(await instance.owner(),                                 user1);
			assert.equal(await instance.name(),                                  'Tokenized NFT');
			assert.equal(await instance.symbol(),                                'TNFT');
			assert.equal(await instance.decimals(),                              '18');
			assert.equal(await instance.totalSupply(),                           '0');
			assert.equal(await instance.balanceOf(instance.address),             '0');
			assert.equal(await instance.balanceOf(user1),                        '0');
			assert.equal(await instance.balanceOf(user2),                        '0');
			assert.equal(await instance.balanceOf(user3),                        '0');
			assert.equal(await instance.balanceOf(other1),                       '0');
			assert.equal(await instance.balanceOf(other2),                       '0');
			assert.equal(await instance.balanceOf(other3),                       '0');
			assert.equal(await web3.eth.getBalance(instance.address),            web3.utils.toWei('0'));
			assert.equal(await web3.eth.getBalance(this.modules.buyout.address), web3.utils.toWei('0'));
		});
	});

	describe('Prepare tokens', function () {
		it('perform', async function () {
			await this.mocks.erc721.mint(instance.address, 1);
			await this.mocks.erc1155.mint(instance.address, 1, 1, '0x');
		});

		after(async function () {
			assert.equal(await instance.owner(),                                 user1);
			assert.equal(await instance.name(),                                  'Tokenized NFT');
			assert.equal(await instance.symbol(),                                'TNFT');
			assert.equal(await instance.decimals(),                              '18');
			assert.equal(await instance.totalSupply(),                           '0');
			assert.equal(await instance.balanceOf(instance.address),             '0');
			assert.equal(await instance.balanceOf(user1),                        '0');
			assert.equal(await instance.balanceOf(user2),                        '0');
			assert.equal(await instance.balanceOf(user3),                        '0');
			assert.equal(await instance.balanceOf(other1),                       '0');
			assert.equal(await instance.balanceOf(other2),                       '0');
			assert.equal(await instance.balanceOf(other3),                       '0');
			assert.equal(await this.mocks.erc721.ownerOf(1),                     instance.address);
			assert.equal(await web3.eth.getBalance(instance.address),            web3.utils.toWei('0'));
			assert.equal(await web3.eth.getBalance(this.modules.buyout.address), web3.utils.toWei('0'));
		});
	});

	describe('Setup crowdsale', function () {
		it('perform', async function () {
			const { receipt } = await this.modules.crowdsale.setup(
				instance.address,
				[[ user1, 8 ], [ user2, 2 ]],
				{ from: user1 }
			);
			console.log('tx.receipt.gasUsed:', receipt.gasUsed);
		});

		after(async function () {
			assert.equal(await instance.owner(),                                 constants.ZERO_ADDRESS);
			assert.equal(await instance.name(),                                  'Tokenized NFT');
			assert.equal(await instance.symbol(),                                'TNFT');
			assert.equal(await instance.decimals(),                              '18');
			assert.equal(await instance.totalSupply(),                           '10');
			assert.equal(await instance.balanceOf(instance.address),             '0');
			assert.equal(await instance.balanceOf(user1),                        '8');
			assert.equal(await instance.balanceOf(user2),                        '2');
			assert.equal(await instance.balanceOf(user3),                        '0');
			assert.equal(await instance.balanceOf(other1),                       '0');
			assert.equal(await instance.balanceOf(other2),                       '0');
			assert.equal(await instance.balanceOf(other3),                       '0');
			assert.equal(await this.mocks.erc721.ownerOf(1),                     instance.address);
			assert.equal(await web3.eth.getBalance(instance.address),            web3.utils.toWei('0'));
			assert.equal(await web3.eth.getBalance(this.modules.buyout.address), web3.utils.toWei('0'));
		});
	});

	describe('Start buyout', function () {
		it('perform', async function () {
			const { receipt } = await this.modules.buyout.openBuyout(instance.address, web3.utils.toWei('0.001'), { from: user2, value: web3.utils.toWei('1') });
			// expectEvent(receipt, 'Transfer', { from: user2, to: this.modules.buyout.address, value: '2' });
			expectEvent(receipt, 'TimerStarted');
			deadline = receipt.logs.find(({ event }) => event == 'TimerStarted').args.deadline;
		});

		after(async function () {
			assert.equal(await instance.owner(),                                 constants.ZERO_ADDRESS);
			assert.equal(await instance.name(),                                  'Tokenized NFT');
			assert.equal(await instance.symbol(),                                'TNFT');
			assert.equal(await instance.decimals(),                              '18');
			assert.equal(await instance.totalSupply(),                           '10');
			assert.equal(await instance.balanceOf(instance.address),             '0');
			assert.equal(await instance.balanceOf(this.modules.buyout.address),  '2');
			assert.equal(await instance.balanceOf(user1),                        '8');
			assert.equal(await instance.balanceOf(user2),                        '0');
			assert.equal(await instance.balanceOf(user3),                        '0');
			assert.equal(await instance.balanceOf(other1),                       '0');
			assert.equal(await instance.balanceOf(other2),                       '0');
			assert.equal(await instance.balanceOf(other3),                       '0');
			assert.equal(await this.mocks.erc721.ownerOf(1),                     instance.address);
			assert.equal(await web3.eth.getBalance(instance.address),            web3.utils.toWei('0'));
			assert.equal(await web3.eth.getBalance(this.modules.buyout.address), web3.utils.toWei('0.008'));
		});
	});

	describe('Close buyout', function () {
		it('perform', async function () {
			const { receipt } = await this.modules.buyout.closeBuyout(instance.address, { from: user1, value: web3.utils.toWei('0.002') });
			// expectEvent(receipt, 'Transfer', { from: instance.address, to: user2, value: '8' });
		});

		after(async function () {
			assert.equal(await instance.owner(),                                 constants.ZERO_ADDRESS);
			assert.equal(await instance.name(),                                  'Tokenized NFT');
			assert.equal(await instance.symbol(),                                'TNFT');
			assert.equal(await instance.decimals(),                              '18');
			assert.equal(await instance.totalSupply(),                           '10');
			assert.equal(await instance.balanceOf(instance.address),             '0');
			assert.equal(await instance.balanceOf(user1),                        '10');
			assert.equal(await instance.balanceOf(user2),                        '0');
			assert.equal(await instance.balanceOf(user3),                        '0');
			assert.equal(await instance.balanceOf(other1),                       '0');
			assert.equal(await instance.balanceOf(other2),                       '0');
			assert.equal(await instance.balanceOf(other3),                       '0');
			assert.equal(await this.mocks.erc721.ownerOf(1),                     instance.address);
			assert.equal(await web3.eth.getBalance(instance.address),            web3.utils.toWei('0'));
			assert.equal(await web3.eth.getBalance(this.modules.buyout.address), web3.utils.toWei('0'));
		});
	});
});
