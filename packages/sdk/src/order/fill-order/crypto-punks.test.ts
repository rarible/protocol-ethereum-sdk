import { randomWord, toAddress, toBigNumber, toBinary, ZERO_ADDRESS } from "@rarible/types"
import { Web3Ethereum } from "@rarible/web3-ethereum"
import Web3 from "web3"
import { awaitAll } from "@rarible/ethereum-sdk-test-common"
import { createGanacheProvider } from "@rarible/ethereum-sdk-test-common/build/create-ganache-provider"
import { sentTx, getSimpleSendWithInjects } from "../../common/send-transaction"
import { getEthereumConfig } from "../../config"
import { deployTestErc20 } from "../contracts/test/test-erc20"
import { deployTestErc721 } from "../contracts/test/test-erc721"
import { deployTransferProxy } from "../contracts/test/test-transfer-proxy"
import { deployErc20TransferProxy } from "../contracts/test/test-erc20-transfer-proxy"
import { deployTestExchangeV2 } from "../contracts/test/test-exchange-v2"
import { deployTestRoyaltiesProvider } from "../contracts/test/test-royalties-provider"
import { deployTestErc1155 } from "../contracts/test/test-erc1155"
import type { SimpleOrder } from "../types"
import { deployCryptoPunks } from "../../nft/contracts/cryptoPunks/deploy"
import { deployCryptoPunkTransferProxy } from "../contracts/test/test-crypto-punks-transfer-proxy"
import { id } from "../../common/id"
import { deployCryptoPunkAssetMatcher } from "../contracts/test/test-crypto-punks-asset-matcher"
import { retry } from "../../common/retry"
import { createEthereumApis } from "../../common/apis"
import { OrderFiller } from "./index"

describe("fillOrder", () => {
	const { addresses, provider } = createGanacheProvider()
	const [sender1Address, sender2Address] = addresses
	const web3 = new Web3(provider as any)
	const ethereum1 = new Web3Ethereum({ web3, from: sender1Address, gas: 1000000 })

	const apis = createEthereumApis("e2e")
	const config = getEthereumConfig("e2e")
	const filler = new OrderFiller(ethereum1, getSimpleSendWithInjects(), config, apis)

	const it = awaitAll({
		testErc20: deployTestErc20(web3, "Test1", "TST1"),
		testErc721: deployTestErc721(web3, "Test", "TST"),
		testErc1155: deployTestErc1155(web3, "Test"),
		transferProxy: deployTransferProxy(web3),
		erc20TransferProxy: deployErc20TransferProxy(web3),
		royaltiesProvider: deployTestRoyaltiesProvider(web3),
		exchangeV2: deployTestExchangeV2(web3),
		punksMarket: deployCryptoPunks(web3),
		punksTransferProxy: deployCryptoPunkTransferProxy(web3),
		punkAssetMatcher: deployCryptoPunkAssetMatcher(web3),
	})

	beforeAll(async () => {
		/**
		 * Configuring
		 */
		await sentTx(
			it.exchangeV2.methods.__ExchangeV2_init(
				toAddress(it.transferProxy.options.address),
				// ZERO_ADDRESS,
				toAddress(it.erc20TransferProxy.options.address),
				toBigNumber("0"),
				// sender1Address,
				ZERO_ADDRESS,
				// toAddress(it.royaltiesProvider.options.address)
				ZERO_ADDRESS
			),
			{ from: sender1Address }
		)
		config.exchange.v1 = toAddress(it.exchangeV2.options.address)
		config.exchange.v2 = toAddress(it.exchangeV2.options.address)
		config.transferProxies.cryptoPunks = toAddress(it.punksTransferProxy.options.address)
		config.chainId = 17
		config.fees.v2 = 100

		await sentTx(it.erc20TransferProxy.methods.addOperator(toAddress(it.exchangeV2.options.address)), {
			from: sender1Address,
		})

		await sentTx(
			it.exchangeV2.methods.setTransferProxy(
				id("CRYPTO_PUNKS"),
				it.punksTransferProxy.options.address
			),
			{from: sender1Address}
		)

		//Set asset matcher for crypto punks
		await sentTx(
			it.exchangeV2.methods.setAssetMatcher(
				id("CRYPTO_PUNKS"),
				it.punkAssetMatcher.options.address
			),
			{from: sender1Address}
		)

		await sentTx(it.punksMarket.methods.allInitialOwnersAssigned(), {from: sender1Address})

	})

	test("get transaction data", async () => {
		const left: SimpleOrder = {
			make: {
				assetType: {
					assetClass: "CRYPTO_PUNKS",
					contract: toAddress(it.punksMarket.options.address),
					tokenId: 0,
				},
				value: toBigNumber("1"),
			},
			maker: sender2Address,
			take: {
				assetType: {
					assetClass: "ETH",
				},
				value: toBigNumber("10"),
			},
			salt: randomWord(),
			type: "CRYPTO_PUNK",
			data: {
				dataType: "CRYPTO_PUNKS_DATA",
			},
		}

		const finalOrder = { ...left, signature: toBinary("0x") }
		await filler.getTransactionData({ order: finalOrder, amount: 1 })
	})

	test("should fill order (buy) with crypto punks asset", async () => {
		//Mint crypto punks
		const punkId = 43
		const punkPrice = 10
		//Mint punks
		await sentTx(it.punksMarket.methods.getPunk(punkId), {from: sender2Address})

		await sentTx(it.punksMarket.methods.offerPunkForSale(punkId, punkPrice), {from: sender2Address})

		const left: SimpleOrder = {
			make: {
				assetType: {
					assetClass: "CRYPTO_PUNKS",
					contract: toAddress(it.punksMarket.options.address),
					tokenId: punkId,
				},
				value: toBigNumber("1"),
			},
			maker: sender2Address,
			take: {
				assetType: {
					assetClass: "ETH",
				},
				value: toBigNumber(punkPrice.toFixed()),
			},
			salt: randomWord(),
			type: "CRYPTO_PUNK",
			data: {
				dataType: "CRYPTO_PUNKS_DATA",
			},
		}

		const finalOrder = { ...left, signature: toBinary("0x") }
		const tx = await filler.buy({ order: finalOrder, amount: 1 })
		await tx.wait()

		await retry(5, 500, async () => {
			const ownerAddress = await it.punksMarket.methods.punkIndexToAddress(punkId).call()

			expect(ownerAddress.toLowerCase()).toBe(sender1Address.toLowerCase())
		})
	})

	test("should accept bid with crypto punks asset", async () => {
		const punkId = 50
		const punkPrice = 10
		//Mint punks
		await sentTx(it.punksMarket.methods.getPunk(punkId), {from: sender1Address})

		await sentTx(it.punksMarket.methods.enterBidForPunk(punkId), {from: sender2Address, value: punkPrice})

		const left: SimpleOrder = {
			make: {
				assetType: {
					assetClass: "ETH",
				},
				value: toBigNumber(punkPrice.toFixed()),
			},
			maker: sender2Address,
			take: {
				assetType: {
					assetClass: "CRYPTO_PUNKS",
					contract: toAddress(it.punksMarket.options.address),
					tokenId: punkId,
				},
				value: toBigNumber("1"),
			},
			salt: randomWord(),
			type: "CRYPTO_PUNK",
			data: {
				dataType: "CRYPTO_PUNKS_DATA",
			},
		}

		const finalOrder = { ...left, signature: toBinary("0x") }
		const tx = await filler.acceptBid({ order: finalOrder, amount: 1 })
		await tx.wait()

		await retry(5, 500, async () => {
			const ownerAddress = await it.punksMarket.methods.punkIndexToAddress(punkId).call()

			expect(ownerAddress.toLowerCase()).toBe(sender2Address.toLowerCase())
		})
	})

})
